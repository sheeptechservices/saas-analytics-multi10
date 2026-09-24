import { Pool, type PoolConfig } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

/* Importar este módulo NÃO abre conexão nem toca disco nem rede.
 *
 * Era esse o defeito que derrubou o deploy na Railway: o cliente nascia na
 * avaliação do módulo, e o `createClient` do libsql com URL `file:` abre o
 * arquivo na hora da construção — não espera a primeira consulta. Durante o
 * "collecting page data" do `next build`, o Next importa cada rota; sem a
 * variável de ambiente, a URL caía no `file:./data/app.db`, o diretório não
 * existia na imagem e o build morria com SQLITE_CANTOPEN.
 *
 * O banco agora é Postgres (Railway), e a propriedade continua valendo:
 * `db` e `pool` são fachadas preguiçosas: o Pool real só nasce no primeiro
 * acesso a uma propriedade, ou seja, dentro do handler que vai consultar —
 * nunca na importação.
 *
 * Vale notar que `new Pool(...)` do `pg` já é preguiçoso por conta própria: ele
 * não abre socket nenhum até o primeiro `query()`/`connect()`. Mesmo assim a
 * fachada fica, porque quem lê a URL do ambiente somos nós — e a leitura precisa
 * acontecer no primeiro uso, não na importação, para o `next build` passar sem
 * nenhuma variável definida. */

/* Não existe mais fallback — e isso é uma decisão, não um esquecimento.
 *
 * Com o Turso havia um arquivo local (`file:./data/app.db`) para cair em
 * desenvolvimento. Postgres não tem equivalente honesto: não há servidor nesta
 * máquina, e inventar um `postgres://localhost:5432/...` que quase nunca vai
 * existir só trocaria um erro claro ("falta DATABASE_URL") por um confuso
 * ("ECONNREFUSED 127.0.0.1:5432"). Então falta de variável é erro em qualquer
 * ambiente — muda só o conselho de onde arrumar. */
const ERRO_SEM_URL_EM_PRODUCAO =
  'DATABASE_URL não está definida. Em produção o banco é o Postgres da Railway: ' +
  'defina DATABASE_URL nas variáveis do serviço (a Railway oferece a URL interna, ' +
  'postgres://...@<serviço>.railway.internal:5432/railway, que é a certa — fica na ' +
  'mesma rede privada do app e não sai para a internet).'

const ERRO_SEM_URL_EM_DESENVOLVIMENTO =
  'DATABASE_URL não está definida. Não existe banco local: coloque em .env.local a URL ' +
  'pública do Postgres da Railway (postgres://...@<região>.proxy.rlwy.net:<porta>/railway) ' +
  'ou a de um Postgres seu. Os testes não precisam dela — usam PGlite em memória.'

function urlDoBanco(): string {
  /* `trim` porque variável de ambiente com espaço sobrando é truthy: sem isso,
   * '   ' passaria direto e o erro viria do driver, sem dizer o que arrumar. */
  const url = process.env.DATABASE_URL?.trim()
  if (url) return url

  /* Preguiçoso de propósito: a falha acontece no primeiro uso, não na
   * importação, para o `next build` continuar passando sem variável nenhuma. */
  if (process.env.NODE_ENV === 'production') {
    throw new Error(ERRO_SEM_URL_EM_PRODUCAO)
  }
  throw new Error(ERRO_SEM_URL_EM_DESENVOLVIMENTO)
}

/** Host da URL, minúsculo, ou '' se a URL não for analisável. Só para decidir TLS. */
function hospedeiro(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Rede em que o tráfego nunca sai da máquina/projeto — TLS não acrescenta nada. */
const LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
function ehRedePrivada(host: string): boolean {
  return host.endsWith('.railway.internal') || LOCAIS.has(host)
}

/* Os únicos valores que o `pg` reconhece em PGSSLMODE (connection-parameters.js,
 * readSSLConfigFromEnvironment). A comparação lá é por igualdade exata, minúscula:
 * qualquer outra coisa CAI no `defaults.ssl`, que é `false`. Ou seja, PGSSLMODE
 * com 'Require', 'allow' ou um espaço sobrando entregaria a conexão EM CLARO,
 * sem aviso nenhum — pela internet, se a URL for a pública. Daí a lista. */
const PGSSLMODE_CONHECIDOS = new Set([
  'disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify',
])

/**
 * TLS. As duas URLs que a Railway oferece pedem coisas diferentes, e o operador
 * não deve precisar editar código para trocar de uma para a outra:
 *
 * • URL interna (`<serviço>.railway.internal:5432`) — rede privada IPv6 do
 *   projeto; o tráfego não sai dela. O Postgres de lá não apresenta certificado
 *   que se possa verificar, e exigir TLS aqui só quebraria a conexão. → sem TLS.
 *
 * • URL pública (`<região>.proxy.rlwy.net:<porta>`) — atravessa a internet, então
 *   TLS é obrigatório. Mas o proxy TCP da Railway apresenta certificado que NÃO
 *   encadeia numa CA pública: verificação completa falha sempre. → TLS ligado com
 *   `rejectUnauthorized: false`.
 *
 * • Qualquer OUTRO host → TLS com verificação COMPLETA da cadeia. A exceção acima
 *   vale só para o proxy da Railway, que é onde ela é forçada; um Postgres de
 *   outro fornecedor não deve herdar a folga. Se a cadeia de lá também não fechar,
 *   o caminho é DATABASE_CA_CERT ou sslmode=no-verify — explícito, não por
 *   descuido.
 *
 * Saídas de emergência, ambas sem tocar no código:
 *   - `?sslmode=...` na própria DATABASE_URL, ou PGSSLMODE com um valor
 *     RECONHECIDO: devolvemos `undefined` e deixamos o `pg` decidir. (Atenção:
 *     nesta versão do pg-connection-string, `sslmode=require` equivale a
 *     `verify-full` e por isso FALHA contra o proxy da Railway; o útil é
 *     `no-verify`.)
 *   - DATABASE_CA_CERT com o PEM da CA: verificação completa contra essa CA.
 *
 * Exportada para teste: é decisão de segurança, e decisão de segurança sem teste
 * é palpite.
 */
export function opcoesDeSsl(url: string): PoolConfig['ssl'] {
  /* O `pg` monta a config final com Object.assign(config, parse(connectionString)),
   * então um `sslmode` na URL sobrescreveria o que passássemos aqui de qualquer
   * jeito. Devolver undefined deixa isso explícito em vez de acidental.
   * (O `parse()` aceita QUALQUER sslmode e devolve ssl={} para os desconhecidos,
   * então a forma de URL nunca cai em texto claro por engano — ao contrário da
   * variável de ambiente, tratada logo abaixo.) */
  if (/[?&]sslmode=/i.test(url)) return undefined

  /* A comparação é com o valor BRUTO, sem trim: o `pg` compara com o bruto, então
   * 'require ' (com espaço no fim) não é reconhecido POR ELE e cairia em texto
   * claro. Aparar aqui antes de comparar esconderia justamente esse caso — foi o
   * que o teste desta função pegou. O trim serve só para decidir se a variável
   * está, na prática, vazia. */
  const modoDoAmbiente = process.env.PGSSLMODE
  if (modoDoAmbiente && modoDoAmbiente.trim()) {
    if (PGSSLMODE_CONHECIDOS.has(modoDoAmbiente)) return undefined
    throw new Error(
      `PGSSLMODE="${modoDoAmbiente}" não é um valor que o driver reconheça. ` +
        `Ele seria ignorado em silêncio e a conexão sairia SEM CRIPTOGRAFIA. ` +
        `Use um de: ${[...PGSSLMODE_CONHECIDOS].join(', ')} (tudo minúsculo, sem espaços), ` +
        `ou apague a variável e deixe o app decidir pelo endereço do banco.`,
    )
  }

  if (ehRedePrivada(hospedeiro(url))) return false

  const ca = process.env.DATABASE_CA_CERT?.trim()
  if (ca) return { ca, rejectUnauthorized: true }

  /* `.rlwy.net` é o proxy TCP da Railway — o único host em que a verificação
   * completa é impossível por construção. */
  if (hospedeiro(url).endsWith('.rlwy.net')) return { rejectUnauthorized: false }

  return { rejectUnauthorized: true }
}

/** Nome que aparece em `pg_stat_activity.application_name`. Com o ambiente da
 *  Railway junto, dá para separar produção de staging numa conexão pendurada. */
function nomeDaAplicacao(): string {
  const ambiente = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'unknown'
  return `saas-analytics-multi10:${ambiente}`
}

/* Os números abaixo valem para ESTE app na Railway: um processo Node ao lado do
 * banco, na mesma rede privada, com um banco de ~600 linhas em 30 tabelas. Era
 * outro mundo no Turso (ida e volta Brasil→EUA, ~170 ms por consulta). */
const CONFIG_DO_POOL = {
  /* 5 s. Nesta rede o connect + handshake é de milissegundos; 5 s é ~1000x o
   * esperado, folga de sobra para um soluço de DNS ou para o banco reiniciando
   * num deploy. Este prazo também cobre a ESPERA por uma vaga no pool quando as
   * `max` conexões estão ocupadas — daí não ser menor: uma rajada curta não pode
   * virar erro. E é bem abaixo do tempo em que o gateway desiste da requisição,
   * então o usuário vê um erro nosso, não um 502 mudo. */
  connectionTimeoutMillis: 5_000,

  /* 30 s (o padrão do próprio `pg`). Uma página do dashboard dispara várias
   * consultas em sequência; 30 s mantém a conexão quente entre elas e entre
   * requisições próximas, e devolve a vaga quando o app fica parado. Encurtar
   * faria reconectar à toa; alongar seguraria conexões ociosas no banco. */
  idleTimeoutMillis: 30_000,

  /* 10 conexões. O Postgres da Railway nasce com max_connections = 100, menos as
   * reservadas para superusuário. O app é um processo só, com handlers curtos, e
   * a carga real é um dashboard sobre 600 linhas. 10 já é folgado, e o teto
   * deixa espaço para: uma segunda réplica durante a troca de deploy, o
   * `psql`/script de cópia do operador, e o cron. Subir mais não acelera nada —
   * só transfere a fila do pool para dentro do banco. */
  max: 10,

  /* 15 s por comando, imposto pelo SERVIDOR. A consulta mais pesada do app é o
   * upsert em lotes de 150 linhas do cron; num banco deste tamanho tudo é
   * milissegundos. 15 s existe para matar consulta enroscada (espera de lock,
   * plano ruim) antes que ela segure uma vaga do pool para sempre — que é como
   * 10 vagas viram 0 e o app inteiro para. */
  statement_timeout: 15_000,

  /* 10 s. Transação aberta e esquecida (um handler que estourou no meio) prende
   * a conexão E segura locks e o horizonte do VACUUM. Mais curto que o
   * statement_timeout porque aqui o banco não está trabalhando, só esperando. */
  idle_in_transaction_session_timeout: 10_000,
} as const satisfies Partial<PoolConfig>

function novoPool(): Pool {
  const connectionString = urlDoBanco()
  const config: PoolConfig = {
    connectionString,
    ssl: opcoesDeSsl(connectionString),
    application_name: nomeDaAplicacao(),
    ...CONFIG_DO_POOL,
  }
  const pool = new Pool(config)

  /* Sem este ouvinte, um cliente OCIOSO que emite 'error' (o banco reiniciou, a
   * rede caiu, o servidor derrubou a conexão) vira exceção não tratada de
   * EventEmitter e DERRUBA O PROCESSO NODE — um soluço do banco viraria queda do
   * app. Com ele, o `pg` descarta a conexão quebrada, o pool abre outra na
   * próxima consulta, e fica só a linha de log. */
  const aoCairOciosa = (err: Error) => console.error('[db] conexão ociosa caiu:', err.message)
  pool.on('error', aoCairOciosa)

  return pool
}

function novoDb(pool: Pool) {
  return drizzle(pool, { schema })
}

type Db = ReturnType<typeof novoDb>

/* Os dois ficam no globalThis. Em desenvolvimento o HMR reavalia este módulo a
 * cada edição e, sem isto, cada recarga deixava para trás um Pool com as suas
 * conexões abertas — o processo acumulava vários falando com o mesmo banco. */
const escopoGlobal = globalThis as typeof globalThis & {
  __pgPool?: Pool
  __pgDb?: Db
}

/* `??=` só atribui quando a fábrica retorna: se `urlDoBanco` lançar, nada fica
 * guardado e a próxima chamada tenta de novo (o ambiente pode ter sido
 * corrigido entre uma requisição e outra). */
function obterPool(): Pool {
  return (escopoGlobal.__pgPool ??= novoPool())
}

function obterDb(): Db {
  return (escopoGlobal.__pgDb ??= novoDb(obterPool()))
}

/**
 * Fachada preguiçosa: repassa tudo para o objeto real, criado no primeiro
 * acesso. Método sai amarrado ao real (`bind`) porque tanto o Pool do `pg`
 * quanto o drizzle guardam estado em campo próprio — com `this` apontando para
 * o Proxy, a leitura desse campo falharia.
 */
function fachadaPreguicosa<T extends object>(obter: () => T): T {
  return new Proxy({} as T, {
    get(_alvo, propriedade) {
      const real = obter()
      const valor = Reflect.get(real, propriedade, real)
      return typeof valor === 'function' ? valor.bind(real) : valor
    },
    set(_alvo, propriedade, valor) {
      return Reflect.set(obter(), propriedade, valor)
    },
    has(_alvo, propriedade) {
      return Reflect.has(obter(), propriedade)
    },
  })
}

export const db: Db = fachadaPreguicosa(obterDb)
/** Pool cru do `pg`, para o SQL que não passa pelo drizzle (lib/cron-lock.ts). */
export const pool: Pool = fachadaPreguicosa(obterPool)
