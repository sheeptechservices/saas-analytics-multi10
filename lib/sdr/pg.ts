// Acesso pooled e limitado ao Postgres/Supabase do cliente (fonte SDR).
//
// POR QUE EXISTE
// Cada requisição abria um `pg.Client` novo — TCP + TLS + SCRAM a cada chamada — e
// fechava em seguida. Pior: os padrões do `pg` deixam tudo sem teto
// (`connectionTimeoutMillis` = 0, `statement_timeout`/`query_timeout` = false), então
// uma conexão travada só caía no timeout de TCP do sistema operacional. Aqui há um
// pool por credencial, com teto de conexões e três relógios (conectar, consulta no
// servidor, consulta no cliente).
//
// REGRA DO PRODUTO: a app SÓ LÊ a base do cliente. Nada neste arquivo escreve.
//
// COMO USAR
//   const { rows } = await withSdrDb(connectionString, sdr =>
//     sdr.query<Linha>('SELECT ... WHERE x = $1', [x]))
//
// O objeto entregue ao callback é o próprio pool: cada `query()` pega e devolve uma
// conexão sozinha, então duas queries disparadas juntas correm mesmo em paralelo.
// Uma rota que já tem o seu try/catch e dispara várias queries pode pegar o pool
// direto com `getSdrPool(connectionString)` e mapear o erro com `mapSdrDbError` —
// é o mesmo caminho, sem callback.
//
// Transação não existe aqui de propósito: tudo é leitura. Um consumidor futuro que
// precise de uma só teria de acrescentar `connect()` à interface `SdrPool` (o objeto
// por baixo é um `pg.Pool` de verdade) e devolver o client com `release()`.
//
// O cache é por CREDENCIAL, não por tenant: o provider (lib/providers/supabase-n8n)
// só recebe uma config, nunca um tenantId, e trocar a credencial de um tenant tem
// que render um pool novo. A chave é um hash — a string de conexão nunca é chave
// nem vai para log.

import { createHash } from 'crypto'
import { rootCertificates } from 'tls'
import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg'
import { CA_SUPABASE, ehHostSupabase } from './supabase-ca'

// ─── Tetos do pool ────────────────────────────────────────────────────────────
//
// max 6                      — a app é leitora e divide o pooler do Supabase com o
//                              n8n, então o número é pequeno de propósito. Mas ele
//                              não se compara com "requisições simultâneas": /leads
//                              gasta DUAS conexões por requisição (o COUNT e a página
//                              correm juntos), e `connectionTimeoutMillis` também é o
//                              teto para ESPERAR por uma conexão ocupada — não só para
//                              abrir uma nova. Com 3, bastavam duas telas de leads
//                              abertas ao mesmo tempo numa base lenta para a terceira
//                              receber 502 sem nem ter chegado ao banco. 6 sustenta
//                              três telas; acima disso a falha volta, e é melhor que
//                              volte como erro do que como fila sem fim.
// idleTimeoutMillis 30 s     — conexão parada meio minuto é devolvida; entre rajadas
//                              de uso não vale a pena segurar socket aberto.
// connectionTimeoutMillis 5 s— teto para conectar (e para esperar por uma conexão do
//                              pool). É o que troca "pendurado até o timeout de TCP"
//                              por uma falha rápida e previsível.
// statement_timeout 10 s     — o servidor cancela a consulta. Vale mesmo se o processo
//                              da app morrer no meio: o Postgres não fica trabalhando à toa.
// query_timeout 10 s         — o mesmo teto do lado do cliente, para o caso de a
//                              resposta não voltar (rede muda, servidor some).
export const SDR_POOL_LIMITS = {
  max:                     6,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout:       10_000,
  query_timeout:           10_000,
} as const

/**
 * Perfil do pool — o teto de 10 s não serve para tudo.
 *
 * `padrao` é para o que responde a uma tela: quem espera é um navegador, e 10 s já
 * é mais do que qualquer pessoa aguenta.
 *
 * `largo` existe para a dedup de leads, que varre a tabela inteira do cliente
 * (~23 mil linhas hoje) e roda uma vez por importação. Sob o teto curto ela passaria
 * a abortar onde antes terminava — e o call site engole falha de dedup de propósito,
 * para não travar a importação inteira quando a base do cliente está fora. O
 * resultado seria o pior possível: "ok" na tela, leads já cadastrados importados de
 * novo e disparados de novo para a mesma pessoa. Um minuto é folga suficiente para a
 * varredura e ainda é um teto — o objetivo nunca foi consulta sem fim.
 *
 * Pool separado, e não `SET statement_timeout`, porque em pool a conexão é
 * reaproveitada: o `SET` vazaria o teto largo para a próxima consulta, que é de tela.
 * `max: 2` porque isto é consulta pesada e sequencial; duas importações simultâneas
 * não se atrapalham, e o custo de o perfil existir é no máximo duas conexões.
 */
export type SdrPoolPerfil = 'padrao' | 'largo'

export const SDR_POOL_LIMITS_LARGO = {
  max:                     2,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout:       60_000,
  query_timeout:           60_000,
} as const

const LIMITES_POR_PERFIL = {
  padrao: SDR_POOL_LIMITS,
  largo:  SDR_POOL_LIMITS_LARGO,
} as const

// Aparece no pg_stat_activity do cliente: dá para ver de onde veio a consulta.
export const SDR_APPLICATION_NAME = 'multi10-sdr'

// ─── Erros ────────────────────────────────────────────────────────────────────

export type SdrDbErrorCode =
  | 'sdr_tls_desabilitado'
  | 'sdr_tls_nao_suportado'
  | 'sdr_conn_invalida'
  | 'sdr_db_timeout'
  | 'sdr_db_indisponivel'
  | 'sdr_db_tls'
  | 'sdr_db_credenciais'
  | 'sdr_db_permissao'
  | 'sdr_db_schema'
  | 'sdr_db_erro'

// Mensagens que PODEM chegar ao usuário. Nenhuma cita host, usuário, senha, porta
// ou texto do driver — esse material fica no log do servidor, via `cause`.
const SDR_DB_MENSAGENS: Record<SdrDbErrorCode, string> = {
  sdr_tls_desabilitado:
    'A conexão com a base do SDR exige TLS, e a fonte cadastrada pede sslmode=disable. Corrija a fonte de dados em Configurações → Integrações.',
  sdr_tls_nao_suportado:
    'A fonte do SDR pede certificado em arquivo (sslcert, sslkey ou sslrootcert), o que esta aplicação não aceita. Use uma conexão TLS com certificado público.',
  sdr_conn_invalida:
    'A string de conexão da fonte SDR é inválida. Refaça o cadastro da fonte em Configurações → Integrações.',
  sdr_db_timeout:
    'A consulta na base do SDR passou do tempo limite e foi cancelada. Tente de novo ou reduza o período consultado.',
  sdr_db_indisponivel:
    'Não foi possível falar com a base de dados do SDR agora. Tente novamente em instantes.',
  sdr_db_tls:
    'A conexão segura com a base do SDR não pôde ser verificada. Confira o certificado do servidor da fonte.',
  sdr_db_credenciais:
    'A base do SDR recusou as credenciais cadastradas. Atualize a fonte de dados em Configurações → Integrações.',
  sdr_db_permissao:
    'O usuário cadastrado na fonte do SDR não tem permissão de leitura nessa tabela.',
  sdr_db_schema:
    'A base do SDR não tem a tabela ou a coluna esperada. Confira se a fonte cadastrada é mesmo a base do SDR.',
  sdr_db_erro:
    'Falha ao consultar a base de dados do SDR.',
}

/**
 * Erro já traduzido para o usuário. O `message` é a mensagem segura em português —
 * quem devolver `err.message` numa resposta não vaza nada. O erro original fica em
 * `cause`, para o log do servidor.
 */
export class SdrDbError extends Error {
  readonly code: SdrDbErrorCode

  constructor(code: SdrDbErrorCode, causa?: unknown) {
    super(SDR_DB_MENSAGENS[code])
    this.name = 'SdrDbError'
    this.code = code
    if (causa !== undefined) this.cause = causa
  }
}

export function sdrDbMensagem(code: SdrDbErrorCode): string {
  return SDR_DB_MENSAGENS[code]
}

// Erros de rede/TLS do Node chegam com `code` textual; os do Postgres, com SQLSTATE.
const CODIGOS_REDE = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'EAI_AGAIN', 'ETIMEDOUT',
])

const CODIGOS_TLS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'EPROTO',
])

// SQLSTATE → código nosso. 57014 é o que o `statement_timeout` dispara.
const SQLSTATE: Record<string, SdrDbErrorCode> = {
  '57014': 'sdr_db_timeout',
  '28P01': 'sdr_db_credenciais',
  '28000': 'sdr_db_credenciais',
  '42501': 'sdr_db_permissao',
  '42P01': 'sdr_db_schema',
  '42703': 'sdr_db_schema',
  '3D000': 'sdr_db_schema',
  '3F000': 'sdr_db_schema',
}

function classificar(err: unknown): SdrDbErrorCode {
  const e        = (err ?? {}) as { code?: unknown; message?: unknown }
  const code     = typeof e.code === 'string' ? e.code : ''
  const mensagem = typeof e.message === 'string' ? e.message : ''

  if (CODIGOS_TLS.has(code)) return 'sdr_db_tls'
  if (CODIGOS_REDE.has(code)) return 'sdr_db_indisponivel'
  if (SQLSTATE[code]) return SQLSTATE[code]

  // Sem código: sobra o texto do driver. Ele NÃO vai para o usuário — serve só para
  // escolher qual das mensagens acima devolver.
  if (/timeout exceeded when trying to connect|connection terminated/i.test(mensagem)) {
    return 'sdr_db_indisponivel'
  }
  if (/query read timeout|statement timeout|canceling statement/i.test(mensagem)) {
    return 'sdr_db_timeout'
  }
  if (/certificate|self[- ]signed|\bssl\b|\btls\b/i.test(mensagem)) return 'sdr_db_tls'
  if (/password authentication failed|no pg_hba\.conf entry|authentication/i.test(mensagem)) {
    return 'sdr_db_credenciais'
  }

  return 'sdr_db_erro'
}

/** Único lugar que traduz erro de driver em mensagem de usuário. */
export function mapSdrDbError(err: unknown): SdrDbError {
  if (err instanceof SdrDbError) return err
  return new SdrDbError(classificar(err), err)
}

// ─── String de conexão ────────────────────────────────────────────────────────

const PARAMS_SSL_ARQUIVO = ['sslcert', 'sslkey', 'sslrootcert']
const PARAMS_SSL = new Set(['sslmode', 'ssl', ...PARAMS_SSL_ARQUIVO])

/**
 * Chave do cache: hash da string de conexão, mais o perfil. A string em si nunca vira
 * chave, nunca entra em log e nunca aparece numa mensagem de erro.
 *
 * O perfil entra na chave porque cada um tem o seu teto de tempo, e teto de pool não
 * se troca depois que o pool existe. `padrao` não acrescenta sufixo: a chave continua
 * sendo exatamente o hash, como antes de o perfil existir.
 */
export function sdrPoolKey(connectionString: string, perfil: SdrPoolPerfil = 'padrao'): string {
  const hash = createHash('sha256').update(connectionString, 'utf8').digest('hex').slice(0, 32)
  return perfil === 'padrao' ? hash : `${hash}:${perfil}`
}

/**
 * Tira os parâmetros de TLS da query string.
 *
 * Motivo: o `pg` monta a config com `Object.assign({}, config, parse(connectionString))`
 * — o que está na string VENCE o que passamos em `ssl`. Com `sslmode=disable` guardado,
 * um `ssl` explícito seria silenciosamente ignorado e a conexão sairia em texto puro.
 * Decidimos o TLS aqui e entregamos ao `pg` uma string sem esses parâmetros, então o
 * `ssl` do config é a única palavra final.
 *
 * O corte é textual no primeiro `?`: a parte com usuário, senha e host não é tocada
 * nem reserializada.
 */
/* Parâmetros que podem sobreviver na string entregue ao driver.
 *
 * Está vazia, e é de propósito. A credencial é dado do CLIENTE, e o `pg` monta a
 * config com `Object.assign({}, config, parse(connectionString))` — o que vem da
 * string VENCE o que o código passa. Antes só os de TLS eram retirados, e o resto
 * passava: `?statement_timeout=0` desligava o cancelamento do lado do servidor,
 * deixando o Postgres do cliente moendo uma consulta que a app já abandonou; e
 * `?application_name=x` apagava a nossa etiqueta no `pg_stat_activity`, que é como
 * se separa o que é a app do que é o n8n.
 *
 * Nenhum parâmetro é necessário hoje: o que a app precisa decidir (TLS e tetos) ela
 * decide aqui. Se um cliente um dia precisar de um de verdade — `options` com um
 * `search_path`, por exemplo — o nome entra nesta lista com o motivo escrito ao
 * lado, e aí é uma decisão, não um descuido. */
const PARAMS_PERMITIDOS = new Set<string>([])

/** Os nomes descartados, para o log dizer o que foi ignorado. Nome não é segredo. */
export function paramsDescartados(connectionString: string): string[] {
  const corte = connectionString.indexOf('?')
  if (corte < 0) return []
  const params = new URLSearchParams(connectionString.slice(corte + 1))
  return Array.from(params.keys()).filter(
    nome => !PARAMS_PERMITIDOS.has(nome.toLowerCase()) && !PARAMS_SSL.has(nome.toLowerCase()),
  )
}

/* O corte é textual no primeiro `?`: a parte com usuário, senha e host não é tocada
 * nem reserializada. */
function semParametrosDeControle(connectionString: string): string {
  const corte = connectionString.indexOf('?')
  if (corte < 0) return connectionString

  const base   = connectionString.slice(0, corte)
  const params = new URLSearchParams(connectionString.slice(corte + 1))
  for (const nome of Array.from(params.keys())) {
    if (!PARAMS_PERMITIDOS.has(nome.toLowerCase())) params.delete(nome)
  }

  const resto = params.toString()
  return resto ? `${base}?${resto}` : base
}

/* Autoridades a confiar para este host.
 *
 * Passar `ca` ao Node SUBSTITUI a loja padrão, não acrescenta — por isso a lista sai
 * daqui montada, com as raízes públicas mais a extra. E por isso a raiz da Supabase
 * não entra para todo mundo: ela vale só nos hosts deles. Confiá-la em qualquer host
 * significaria aceitar um certificado emitido pela Supabase para um domínio alheio.
 *
 * `SDR_CA_CERT` existe para o cliente que usa outro provedor com CA própria. É
 * variável de ambiente, do operador — nunca vem da string de conexão, que é dado do
 * cliente (ler arquivo ou CA a partir dali é o que `sdr_tls_nao_suportado` recusa). */
function autoridadesPara(host: string): string[] | undefined {
  const extras: string[] = []
  if (ehHostSupabase(host)) extras.push(CA_SUPABASE)

  const doOperador = process.env.SDR_CA_CERT?.trim()
  if (doOperador) extras.push(doOperador)

  return extras.length ? [...rootCertificates, ...extras] : undefined
}

/**
 * Valida a string guardada e monta a config do pool.
 *
 * TLS é obrigatório: `sslmode=disable` (ou `ssl=0`/`ssl=false`) é recusado em vez de
 * abrir a conexão em texto puro. Sem parâmetro nenhum — o caso comum do Supabase —
 * conectamos com verificação de certificado ligada (o Supabase serve certificado de
 * CA pública, então a cadeia padrão do Node basta). A única forma de abrir mão da
 * verificação é o operador escrever `sslmode=no-verify` na string; nada aqui desliga
 * verificação por conta própria.
 *
 * Lança `SdrDbError` — nunca devolve config inválida.
 */
export function buildSdrPoolConfig(
  connectionString: string,
  perfil: SdrPoolPerfil = 'padrao',
): PoolConfig {
  const bruta = typeof connectionString === 'string' ? connectionString.trim() : ''
  if (!bruta) throw new SdrDbError('sdr_conn_invalida')

  let url: URL
  try {
    url = new URL(bruta)
  } catch {
    throw new SdrDbError('sdr_conn_invalida')
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new SdrDbError('sdr_conn_invalida')
  }
  if (!url.hostname) throw new SdrDbError('sdr_conn_invalida')

  const params = url.searchParams
  // Certificado em arquivo faria o `pg` ler o disco do servidor a partir de um valor
  // que veio do cliente, e ignorá-lo em silêncio mudaria a confiança sem avisar.
  const nomesPresentes = new Set(Array.from(params.keys()).map(n => n.trim().toLowerCase()))
  for (const nome of PARAMS_SSL_ARQUIVO) {
    if (nomesPresentes.has(nome)) throw new SdrDbError('sdr_tls_nao_suportado')
  }

  /* A chave também é lida sem depender da caixa. `params.get('sslmode')` é sensível
   * a maiúsculas, então `?SSLMODE=disable` escapava da recusa — e só não abria
   * conexão em texto puro porque a RETIRADA, essa sim, era insensível. Segurança por
   * acidente não é segurança: aqui a recusa passa a ser explícita. */
  const valorDoParam = (chave: string): string => {
    for (const [nome, valor] of params) {
      if (nome.trim().toLowerCase() === chave) return valor.trim().toLowerCase()
    }
    return ''
  }

  const sslmode = valorDoParam('sslmode')
  const sslFlag = valorDoParam('ssl')
  if (sslmode === 'disable' || sslFlag === '0' || sslFlag === 'false') {
    throw new SdrDbError('sdr_tls_desabilitado')
  }

  /* `no-verify` continua sendo a saída explícita do operador, e continua sendo a
   * única forma de a verificação ficar desligada. O caminho normal agora VERIFICA
   * mesmo contra CA privada: a Supabase opera raiz própria, e antes disto toda
   * consulta ao SDR morria com SELF_SIGNED_CERT_IN_CHAIN — o que empurrava para o
   * `no-verify`, que cifra sem autenticar. Fixando a raiz, a cadeia é conferida. */
  const autoridades = autoridadesPara(url.hostname)
  const ssl: PoolConfig['ssl'] = sslmode === 'no-verify'
    ? { rejectUnauthorized: false }
    : autoridades
      ? { rejectUnauthorized: true, ca: autoridades }
      : { rejectUnauthorized: true }

  return {
    connectionString: semParametrosDeControle(bruta),
    ssl,
    application_name: SDR_APPLICATION_NAME,
    // Sem isso o pool segura o event loop e o processo não encerra sozinho.
    allowExitOnIdle: true,
    ...LIMITES_POR_PERFIL[perfil],
  }
}

// ─── Pool ─────────────────────────────────────────────────────────────────────

/** O mínimo que um call site do SDR usa. */
export interface SdrQueryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>
}

export interface SdrPool extends SdrQueryable {
  end(): Promise<void>
  on(evento: 'error', ouvinte: (err: Error) => void): unknown
}

export type SdrPoolFactory = (config: PoolConfig) => SdrPool

const fabricaPadrao: SdrPoolFactory = config => new Pool(config) as unknown as SdrPool

let fabrica: SdrPoolFactory = fabricaPadrao

// Único estado global do módulo: um pool por credencial.
const pools = new Map<string, SdrPool>()

/**
 * USO EXCLUSIVO DE TESTE: troca a fábrica de pools e esvazia o cache.
 * Passar `null` devolve a fábrica real (`new Pool`).
 */
export function setSdrPoolFactory(factory: SdrPoolFactory | null): void {
  fabrica = factory ?? fabricaPadrao
  pools.clear()
}

function novoPool(connectionString: string, perfil: SdrPoolPerfil = 'padrao'): SdrPool {
  const pool = fabrica(buildSdrPoolConfig(connectionString, perfil))
  // Um cliente ocioso que cai emite 'error' no pool; sem ouvinte, o Node derruba o
  // processo inteiro. Logamos só o código traduzido — sem host, sem credencial.
  pool.on('error', err => {
    console.error('[sdr pg pool] conexão ociosa caiu:', mapSdrDbError(err).code)
  })
  return pool
}

/**
 * Pool da credencial, criado na primeira vez e reaproveitado depois. `perfil` escolhe
 * o teto de tempo — use `'largo'` só para consulta reconhecidamente pesada e rara.
 */
export function getSdrPool(
  connectionString: string,
  perfil: SdrPoolPerfil = 'padrao',
): SdrPool {
  const chave = sdrPoolKey(connectionString, perfil)
  const existente = pools.get(chave)
  if (existente) return existente

  const pool = novoPool(connectionString, perfil)
  pools.set(chave, pool)
  return pool
}

/**
 * Roda `fn` contra a base do SDR usando o pool da credencial. Qualquer erro sai
 * como `SdrDbError` — mensagem em português, sem detalhe interno.
 */
export async function withSdrDb<T>(
  connectionString: string,
  fn: (sdr: SdrQueryable) => Promise<T>,
  perfil: SdrPoolPerfil = 'padrao',
): Promise<T> {
  let pool: SdrPool
  try {
    pool = getSdrPool(connectionString, perfil)
  } catch (err) {
    throw mapSdrDbError(err)
  }

  try {
    return await fn(pool)
  } catch (err) {
    throw mapSdrDbError(err)
  }
}

/**
 * Igual ao `withSdrDb`, mas com pool descartável: usado no teste de conexão, onde a
 * credencial ainda nem foi salva e guardar um pool por tentativa só encheria o cache.
 */
export async function withSdrDbOnce<T>(
  connectionString: string,
  fn: (sdr: SdrQueryable) => Promise<T>,
): Promise<T> {
  let pool: SdrPool
  try {
    pool = novoPool(connectionString)
  } catch (err) {
    throw mapSdrDbError(err)
  }

  try {
    return await fn(pool)
  } catch (err) {
    throw mapSdrDbError(err)
  } finally {
    await pool.end().catch(() => {})
  }
}

/**
 * Derruba o pool de uma credencial. Chamado quando o tenant reescreve a fonte de
 * dados: o pool antigo ficaria aberto para sempre contra a credencial velha.
 */
export async function closeSdrPool(connectionString: string): Promise<void> {
  // Os dois perfis, porque a credencial velha tem de sair inteira: deixar o pool
  // `largo` para trás seria deixar aberta exatamente a conexão de vida mais longa.
  const perfis: SdrPoolPerfil[] = ['padrao', 'largo']
  const alvos = perfis
    .map(perfil => sdrPoolKey(connectionString, perfil))
    .map(chave => {
      const pool = pools.get(chave)
      if (pool) pools.delete(chave)
      return pool
    })
    .filter((pool): pool is SdrPool => Boolean(pool))

  await Promise.all(alvos.map(pool => pool.end().catch(() => {})))
}

/** Derruba todos os pools (desligamento, teste). */
export async function closeAllSdrPools(): Promise<void> {
  const abertos = Array.from(pools.values())
  pools.clear()
  await Promise.all(abertos.map(p => p.end().catch(() => {})))
}
