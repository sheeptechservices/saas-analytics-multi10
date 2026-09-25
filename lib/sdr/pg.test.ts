// Testes do acesso pooled à base do SDR (lib/sdr/pg).
//
// O que dá para testar de verdade sem banco: a leitura da string de conexão, a
// tradução de erro do driver e as opções que chegam ao pool. Para o pool usamos uma
// fábrica falsa — o `pg` em si não é mockado. Onde a pergunta é "o que o pg faria
// com isso?", a resposta vem do próprio `pg`: montamos um `Client` (que resolve a
// config no construtor, sem abrir conexão) e lemos o que ele resolveu.
//
// Nenhum teste aqui abre conexão com banco nenhum.

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { PoolConfig } from 'pg'
// Módulo que o próprio `pg` usa para ler a string de conexão — é o comportamento
// dele que estamos afirmando aqui, não uma imitação.
import { parse } from 'pg-connection-string'
import { CA_SUPABASE, CA_SUPABASE_VENCE_EM, ehHostSupabase } from '@/lib/sdr/supabase-ca'
import {
  SDR_POOL_LIMITS,
  SDR_POOL_LIMITS_LARGO,
  SdrDbError,
  buildSdrPoolConfig,
  closeAllSdrPools,
  closeSdrPool,
  getSdrPool,
  mapSdrDbError,
  sdrPoolKey,
  setSdrPoolFactory,
  withSdrDb,
  withSdrDbOnce,
  type SdrPool,
} from '@/lib/sdr/pg'

const SENHA = 'S3nh4-do-cliente'
const HOST  = 'aws-0-sa-east-1.pooler.supabase.com'
const CONN  = `postgresql://postgres.abcdefghijkl:${SENHA}@${HOST}:6543/postgres`

// ─── Fábrica falsa de pool ────────────────────────────────────────────────────

interface PoolFalso extends SdrPool {
  config: PoolConfig
  consultas: string[]
  encerrado: boolean
  // Guardado porque o ouvinte de 'error' é a linha que impede o Node de derrubar o
  // processo inteiro quando um cliente ocioso cai. Uma fábrica que ignora `on`
  // deixaria esse ouvinte sumir sem nenhum teste reclamar.
  ouvintes: Array<[string, (err: Error) => void]>
}

function fabricaFalsa(resposta?: () => Promise<unknown>) {
  const criados: PoolFalso[] = []
  setSdrPoolFactory((config: PoolConfig) => {
    const pool: PoolFalso = {
      config,
      consultas: [],
      encerrado: false,
      ouvintes: [],
      async query(text: string) {
        pool.consultas.push(text)
        if (resposta) await resposta()
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }
      },
      async end() { pool.encerrado = true },
      on(evento: 'error', ouvinte: (err: Error) => void) {
        pool.ouvintes.push([evento, ouvinte])
        return pool
      },
    }
    criados.push(pool)
    return pool
  })
  return criados
}

afterEach(async () => {
  await closeAllSdrPools()
  setSdrPoolFactory(null)
})

/** Roda `fn` esperando um SdrDbError e devolve o erro (assert.throws não devolve). */
function erroDe(fn: () => unknown): SdrDbError {
  try {
    fn()
  } catch (err) {
    return err as SdrDbError
  }
  throw new assert.AssertionError({ message: 'esperava um SdrDbError e nada foi lançado' })
}

// ─── Chave do cache ───────────────────────────────────────────────────────────

test('sdrPoolKey: estável, em hexadecimal, e nunca é a string bruta', () => {
  const chave = sdrPoolKey(CONN)

  assert.equal(chave, sdrPoolKey(CONN))
  assert.match(chave, /^[0-9a-f]{32}$/)
  assert.ok(!chave.includes(SENHA))
  assert.ok(!chave.includes(HOST))
  assert.ok(!chave.includes('postgres'))
})

test('sdrPoolKey: credencial diferente, chave diferente', () => {
  const outra = CONN.replace(SENHA, 'outra-senha')
  assert.notEqual(sdrPoolKey(CONN), sdrPoolKey(outra))
})

// ─── TLS ──────────────────────────────────────────────────────────────────────

/* `CONN` aponta para o pooler da Supabase, que é CA privada — então a config sai com
 * a lista de autoridades. Estas duas funções dizem o que checar sem repetir o
 * raciocínio em cada teste. */
function conferirVerificacaoLigada(ssl: unknown, { comCaSupabase }: { comCaSupabase: boolean }) {
  const s = ssl as { rejectUnauthorized?: boolean; ca?: string[] }
  assert.equal(s.rejectUnauthorized, true, 'a verificação tem de continuar ligada')
  if (!comCaSupabase) {
    assert.equal(s.ca, undefined, 'host de CA pública não recebe lista de autoridades')
    return
  }
  assert.ok(Array.isArray(s.ca), 'host da Supabase precisa da lista de autoridades')
  assert.ok(s.ca.includes(CA_SUPABASE), 'a raiz da Supabase tem de estar na lista')
  // Passar `ca` SUBSTITUI a loja padrão do Node: sem as raízes públicas junto,
  // qualquer outro host deixaria de validar.
  assert.ok(s.ca.length > 10, 'as raízes públicas têm de continuar na lista')
}

test('sem parâmetro de ssl: conecta com verificação de certificado ligada', () => {
  conferirVerificacaoLigada(buildSdrPoolConfig(CONN).ssl, { comCaSupabase: true })
})

test('sslmode=require é aceito e sai com verificação ligada', () => {
  conferirVerificacaoLigada(buildSdrPoolConfig(`${CONN}?sslmode=require`).ssl, { comCaSupabase: true })
})

test('sslmode=verify-full é aceito', () => {
  conferirVerificacaoLigada(buildSdrPoolConfig(`${CONN}?sslmode=verify-full`).ssl, { comCaSupabase: true })
})

/* A Supabase opera CA própria, e a raiz dela é autoassinada — não está na loja do
 * Node. Sem fixá-la, TODA consulta ao SDR morria com SELF_SIGNED_CERT_IN_CHAIN, e a
 * saída seria `no-verify`, que cifra sem autenticar. Estes testes existem para que
 * ninguém volte a esse caminho sem perceber. */
test('host da Supabase recebe a raiz deles, e a verificação CONTINUA ligada', () => {
  const ssl = buildSdrPoolConfig(CONN).ssl as { rejectUnauthorized: boolean; ca: string[] }
  assert.equal(ssl.rejectUnauthorized, true, 'fixar a CA não pode virar desligar a verificação')
  assert.ok(ssl.ca.includes(CA_SUPABASE))
})

test('host de CA pública NÃO recebe a raiz da Supabase', () => {
  // Confiar a raiz da Supabase em qualquer host significaria aceitar um certificado
  // emitido por eles para um domínio alheio.
  const ssl = buildSdrPoolConfig('postgresql://u:s@db.fornecedor-qualquer.com:5432/x').ssl
  assert.deepEqual(ssl, { rejectUnauthorized: true })
})

test('o sufixo tem de ser o domínio inteiro, não o fim do texto', () => {
  assert.equal(ehHostSupabase('aws-0-sa-east-1.pooler.supabase.com'), true)
  assert.equal(ehHostSupabase('db.abcdefghijkl.supabase.co'), true)
  assert.equal(ehHostSupabase('supabase.com'), true)
  // Nenhum destes é a Supabase, por mais que o texto termine parecido.
  assert.equal(ehHostSupabase('evil-supabase.com'), false)
  assert.equal(ehHostSupabase('supabase.com.invasor.net'), false)
  assert.equal(ehHostSupabase('naosupabase.co'), false)
  assert.equal(ehHostSupabase('supabase.company'), false)
})

test('no-verify continua sendo a ÚNICA forma de a verificação ficar desligada', () => {
  // A varredura do arquivo inteiro: nenhuma outra combinação pode produzir false.
  const casos = [
    CONN, `${CONN}?sslmode=require`, `${CONN}?sslmode=verify-full`,
    'postgresql://u:s@db.fornecedor-qualquer.com:5432/x',
    'postgresql://u:s@db.abcdefghijkl.supabase.co:5432/postgres',
  ]
  for (const url of casos) {
    const ssl = buildSdrPoolConfig(url).ssl as { rejectUnauthorized: boolean }
    assert.equal(ssl.rejectUnauthorized, true, `${url} não podia relaxar a verificação`)
  }
  const solto = buildSdrPoolConfig(`${CONN}?sslmode=no-verify`).ssl as { rejectUnauthorized: boolean }
  assert.equal(solto.rejectUnauthorized, false, 'e no-verify tem de continuar funcionando')
})

test('a raiz fixada ainda não venceu — e avisa um ano antes', () => {
  /* Quando a Supabase rodar a raiz, a cadeia deixa de fechar e o SDR cai com o mesmo
   * SELF_SIGNED_CERT_IN_CHAIN de antes. Este teste reprova um ano antes disso, para
   * a troca ser uma tarefa e não um incidente. */
  const umAno = 365 * 24 * 60 * 60 * 1000
  assert.ok(Date.now() < CA_SUPABASE_VENCE_EM - umAno,
    'a raiz da Supabase vence em menos de um ano: baixe a nova no painel e substitua CA_SUPABASE')
})

test('sslmode=disable é RECUSADO com mensagem em português', () => {
  const erro = erroDe(() => buildSdrPoolConfig(`${CONN}?sslmode=disable`))

  assert.ok(erro instanceof SdrDbError)
  assert.equal(erro.code, 'sdr_tls_desabilitado')
  assert.match(erro.message, /TLS/)
  assert.ok(!erro.message.includes(HOST))
  assert.ok(!erro.message.includes(SENHA))
})

test('sslmode=DISABLE (maiúsculas) também é recusado', () => {
  const erro = erroDe(() => buildSdrPoolConfig(`${CONN}?sslmode=DISABLE`))
  assert.equal(erro.code, 'sdr_tls_desabilitado')
})

test('ssl=0 e ssl=false também são recusados', () => {
  for (const sufixo of ['?ssl=0', '?ssl=false']) {
    const erro = erroDe(() => buildSdrPoolConfig(CONN + sufixo))
    assert.equal(erro.code, 'sdr_tls_desabilitado')
  }
})

test('sslmode=no-verify: TLS continua ligado, só a verificação cai', () => {
  const cfg = buildSdrPoolConfig(`${CONN}?sslmode=no-verify`)
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: false })
})

test('certificado em arquivo (sslrootcert/sslcert/sslkey) é recusado', () => {
  for (const param of ['sslrootcert=/tmp/ca.pem', 'sslcert=/tmp/c.pem', 'sslkey=/tmp/k.pem']) {
    const erro = erroDe(() => buildSdrPoolConfig(`${CONN}?${param}`))
    assert.equal(erro.code, 'sdr_tls_nao_suportado')
  }
})

// Este é o motivo de a string entregue ao `pg` sair sem parâmetro de ssl: o `pg`
// monta a config com `Object.assign({}, config, parse(connectionString))`, então o
// que estivesse na string venceria o `ssl` que passamos — inclusive um `ssl: false`.
test('depois da limpeza, a string guardada não sobrescreve mais o ssl do config', () => {
  // Antes: o parser do pg devolve um ssl que venceria o nosso.
  assert.equal(parse(`${CONN}?sslmode=disable`).ssl, false)
  assert.deepEqual(parse(`${CONN}?sslmode=no-verify`).ssl, { rejectUnauthorized: false })

  // Depois: nenhum ssl volta do parser, então o config é a palavra final.
  const cfg   = buildSdrPoolConfig(`${CONN}?sslmode=require&pgbouncer=true`)
  const visto = parse(String(cfg.connectionString)) as unknown as Record<string, unknown>

  assert.equal('ssl' in visto, false)
  assert.equal(visto.sslmode, undefined)
  // e o resto da string chega ao pg igualzinho
  assert.equal(visto.host, HOST)
  assert.equal(visto.port, '6543')
  assert.equal(visto.pgbouncer, 'true')
})

test('a string entregue ao pg perde os parâmetros de ssl e guarda o resto', () => {
  const cfg = buildSdrPoolConfig(`${CONN}?sslmode=require&pgbouncer=true&connect_timeout=10`)

  assert.ok(!String(cfg.connectionString).includes('sslmode'))
  assert.match(String(cfg.connectionString), /pgbouncer=true/)
  assert.match(String(cfg.connectionString), /connect_timeout=10/)
  // usuário, senha, host e porta seguem intactos — a parte antes do '?' não é remontada
  assert.ok(String(cfg.connectionString).startsWith(CONN))
})

test('sem query string, a string de conexão passa inteira', () => {
  const cfg = buildSdrPoolConfig(CONN)
  assert.equal(cfg.connectionString, CONN)
})

// ─── String malformada ────────────────────────────────────────────────────────

test('string malformada é recusada antes de qualquer conexão', () => {
  const ruins = [
    '',
    '   ',
    'não é url',
    'postgres://',
    'https://exemplo.com/banco',
    'mysql://u:p@host:3306/db',
    'postgres.abcdef:senha@host:5432/postgres',
  ]

  for (const ruim of ruins) {
    const erro = erroDe(() => buildSdrPoolConfig(ruim))
    assert.ok(erro instanceof SdrDbError, ruim)
    assert.equal(erro.code, 'sdr_conn_invalida', ruim)
  }
})

test('postgres:// e postgresql:// são aceitos', () => {
  assert.ok(buildSdrPoolConfig('postgres://u:p@host.exemplo.com:5432/db'))
  assert.ok(buildSdrPoolConfig('postgresql://u:p@host.exemplo.com:5432/db'))
})

// ─── Ouvinte de 'error' do pool ───────────────────────────────────

// Este ouvinte não é detalhe: um cliente ocioso do `pg` que cai emite 'error' no
// pool e, sem ouvinte, o Node **derruba o processo inteiro**. Ou seja, uma oscilação
// na base de um cliente viraria queda do app para todos. Os três testes abaixo
// cobrem as três formas de perder isso: não registrar, registrar no evento errado,
// e registrar um ouvinte que ele mesmo lança.

test("todo pool nasce com ouvinte de 'error' registrado", () => {
  const criados = fabricaFalsa()
  getSdrPool(CONN)

  const eventos = criados[0].ouvintes.map(([evento]) => evento)
  assert.ok(
    eventos.includes('error'),
    `pool criado sem ouvinte de 'error' (registrados: ${JSON.stringify(eventos)}) — ` +
      'um cliente ocioso que cai derrubaria o processo',
  )
})

test("o pool descartável do teste de conexão também ganha o ouvinte", async () => {
  const criados = fabricaFalsa()
  await withSdrDbOnce(CONN, async sdr => { await sdr.query('select 1') })

  assert.equal(criados.length, 1)
  assert.ok(criados[0].ouvintes.some(([evento]) => evento === 'error'))
})

test("o ouvinte de 'error' engole o erro e não vaza a credencial no log", () => {
  const criados = fabricaFalsa()
  getSdrPool(CONN)

  const ouvinte = criados[0].ouvintes.find(([evento]) => evento === 'error')?.[1]
  assert.ok(ouvinte, "sem ouvinte de 'error' para exercitar")

  const original = console.error
  const linhas: string[] = []
  console.error = (...args: unknown[]) => { linhas.push(args.map(String).join(' ')) }
  try {
    // Se o ouvinte lançar, o processo cai do mesmo jeito — registrar não basta.
    assert.doesNotThrow(() => {
      ouvinte(Object.assign(new Error(`connection terminated — ${HOST}`), { code: 'ECONNRESET' }))
    })
  } finally {
    console.error = original
  }

  const log = linhas.join('\n')
  assert.ok(log.length > 0, 'a queda passou sem nenhuma linha de log')
  for (const agulha of [SENHA, HOST, 'postgresql://']) {
    assert.ok(!log.includes(agulha), `o log do ouvinte vazou "${agulha}": ${log}`)
  }
})

// ─── Tetos do pool ────────────────────────────────────────────────────────────

test('as opções que chegam ao pool têm todos os tetos', () => {
  const criados = fabricaFalsa()
  getSdrPool(CONN)

  assert.equal(criados.length, 1)
  const cfg = criados[0].config

  assert.equal(cfg.max, 6)
  assert.equal(cfg.idleTimeoutMillis, 30_000)
  assert.equal(cfg.connectionTimeoutMillis, 5_000)
  assert.equal(cfg.statement_timeout, 10_000)
  assert.equal(cfg.query_timeout, 10_000)
  assert.equal(cfg.allowExitOnIdle, true)
  assert.equal(cfg.application_name, 'multi10-sdr')
})

test('o perfil largo troca o teto de tempo, e só ele', () => {
  const criados = fabricaFalsa()
  getSdrPool(CONN, 'largo')

  const cfg = criados[0].config
  assert.equal(cfg.statement_timeout, 60_000)
  assert.equal(cfg.query_timeout, 60_000)
  // Continua sendo um teto: perfil largo não é consulta sem fim.
  assert.ok(SDR_POOL_LIMITS_LARGO.statement_timeout <= 120_000)
  // Pesado e sequencial: o preço de o perfil existir é no máximo duas conexões.
  assert.equal(cfg.max, 2)
  // O resto não muda — TLS e teto de conexão são os mesmos.
  assert.equal(cfg.connectionTimeoutMillis, 5_000)
  conferirVerificacaoLigada(cfg.ssl, { comCaSupabase: true })
  assert.equal(cfg.application_name, 'multi10-sdr')
})

test('largo e padrão são pools diferentes para a mesma credencial', () => {
  const criados = fabricaFalsa()
  const padrao = getSdrPool(CONN)
  const largo  = getSdrPool(CONN, 'largo')

  // Se caíssem no mesmo pool, o teto de 60 s valeria para consulta de tela — ou o
  // de 10 s para a dedup, que é justamente o que este perfil evita.
  assert.notEqual(padrao, largo)
  assert.equal(criados.length, 2)
  assert.equal(criados[0].config.statement_timeout, 10_000)
  assert.equal(criados[1].config.statement_timeout, 60_000)

  // E cada um continua reaproveitado.
  assert.equal(getSdrPool(CONN), padrao)
  assert.equal(getSdrPool(CONN, 'largo'), largo)
  assert.equal(criados.length, 2)
})

test('a chave do perfil padrão é a mesma de antes de o perfil existir', () => {
  // Garante que acrescentar o perfil não invalidou o cache nem mudou a chave que o
  // resto do código (closeSdrPool) calcula por conta própria.
  assert.equal(sdrPoolKey(CONN), sdrPoolKey(CONN, 'padrao'))
  assert.notEqual(sdrPoolKey(CONN), sdrPoolKey(CONN, 'largo'))
  // E a chave segue sendo hash: nada da credencial aparece nela.
  for (const agulha of [SENHA, HOST, 'postgres']) {
    assert.ok(!sdrPoolKey(CONN, 'largo').includes(agulha))
  }
})

test('trocar a credencial derruba os DOIS perfis, não só o padrão', async () => {
  const criados = fabricaFalsa()
  getSdrPool(CONN)
  getSdrPool(CONN, 'largo')
  assert.equal(criados.length, 2)

  await closeSdrPool(CONN)

  // Deixar o pool largo para trás seria deixar aberta a conexão de vida mais longa
  // contra uma credencial que o cliente acabou de revogar.
  assert.ok(criados.every(p => p.encerrado), 'sobrou pool aberto na credencial antiga')
  getSdrPool(CONN, 'largo')
  assert.equal(criados.length, 3, 'o pool largo antigo continuou no cache')
})

test('nenhum teto ficou no padrão do pg (0 / false)', () => {
  // Os padrões do pg são justamente estes: conectar sem teto e consulta sem teto.
  assert.notEqual(SDR_POOL_LIMITS.connectionTimeoutMillis, 0)
  assert.equal(typeof SDR_POOL_LIMITS.statement_timeout, 'number')
  assert.equal(typeof SDR_POOL_LIMITS.query_timeout, 'number')
  // Margem do critério P2: a falha por host inalcançável cabe em ~6 s.
  assert.ok(SDR_POOL_LIMITS.connectionTimeoutMillis <= 6_000)
})

// ─── Cache de pools ───────────────────────────────────────────────────────────

test('a mesma credencial reaproveita o mesmo pool', () => {
  const criados = fabricaFalsa()

  const a = getSdrPool(CONN)
  const b = getSdrPool(CONN)

  assert.equal(a, b)
  assert.equal(criados.length, 1)
})

// É assim que /api/sdr/leads e /blast usam o pool: pegam o pool e mapeiam o erro
// no catch que já existe. A recusa de TLS tem que chegar lá como SdrDbError.
test('getSdrPool recusa sslmode=disable e não cria pool nenhum', () => {
  const criados = fabricaFalsa()

  const erro = erroDe(() => getSdrPool(`${CONN}?sslmode=disable`))

  assert.equal(erro.code, 'sdr_tls_desabilitado')
  assert.equal(mapSdrDbError(erro).code, 'sdr_tls_desabilitado')
  assert.equal(criados.length, 0)
})

// O COUNT e a página de /api/sdr/leads saem juntos: só sobra paralelismo se o teto
// de conexões for maior que 1 e as duas queries forem para o mesmo pool.
test('duas queries simultâneas vão para o mesmo pool, que tem mais de uma conexão', async () => {
  const criados = fabricaFalsa()

  const sdr = getSdrPool(CONN)
  await Promise.all([sdr.query('SELECT 1'), sdr.query('SELECT 2')])

  assert.equal(criados.length, 1)
  assert.deepEqual(criados[0].consultas, ['SELECT 1', 'SELECT 2'])
  assert.ok(SDR_POOL_LIMITS.max >= 2)
})

test('credencial diferente ganha pool próprio', () => {
  const criados = fabricaFalsa()

  getSdrPool(CONN)
  getSdrPool(CONN.replace(SENHA, 'outra-senha'))

  assert.equal(criados.length, 2)
})

test('closeSdrPool derruba o pool e o próximo uso cria outro', async () => {
  const criados = fabricaFalsa()

  getSdrPool(CONN)
  await closeSdrPool(CONN)
  assert.equal(criados[0].encerrado, true)

  getSdrPool(CONN)
  assert.equal(criados.length, 2)
})

test('closeSdrPool numa credencial sem pool não quebra', async () => {
  fabricaFalsa()
  await closeSdrPool(CONN)
})

// ─── withSdrDb ────────────────────────────────────────────────────────────────

test('withSdrDb entrega um executor de query e devolve o resultado', async () => {
  const criados = fabricaFalsa()

  const linhas = await withSdrDb(CONN, async db => {
    const res = await db.query('SELECT 1')
    return res.rows
  })

  assert.deepEqual(linhas, [])
  assert.deepEqual(criados[0].consultas, ['SELECT 1'])
})

test('withSdrDb recusa sslmode=disable sem criar pool nenhum', async () => {
  const criados = fabricaFalsa()

  await assert.rejects(
    () => withSdrDb(`${CONN}?sslmode=disable`, async db => db.query('SELECT 1')),
    (err: SdrDbError) => err instanceof SdrDbError && err.code === 'sdr_tls_desabilitado',
  )
  assert.equal(criados.length, 0)
})

test('withSdrDb traduz o erro do driver antes de devolver', async () => {
  fabricaFalsa(async () => {
    throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
  })

  await assert.rejects(
    () => withSdrDb(CONN, async db => db.query('SELECT pg_sleep(60)')),
    (err: SdrDbError) => err instanceof SdrDbError && err.code === 'sdr_db_timeout',
  )
})

test('withSdrDbOnce encerra o pool e não deixa nada no cache', async () => {
  const criados = fabricaFalsa()

  await withSdrDbOnce(CONN, async db => db.query('SELECT 1'))
  assert.equal(criados[0].encerrado, true)

  getSdrPool(CONN)
  assert.equal(criados.length, 2)
})

test('withSdrDbOnce encerra o pool mesmo quando a query falha', async () => {
  const criados = fabricaFalsa(async () => { throw new Error('boom') })

  await assert.rejects(() => withSdrDbOnce(CONN, async db => db.query('SELECT 1')))
  assert.equal(criados[0].encerrado, true)
})

// ─── Tradução de erro ─────────────────────────────────────────────────────────

const ERROS_DE_DRIVER: Array<{ nome: string; erro: unknown; code: string }> = [
  {
    nome: 'host inexistente',
    erro: Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST}`), { code: 'ENOTFOUND' }),
    code: 'sdr_db_indisponivel',
  },
  {
    nome: 'conexão recusada',
    erro: Object.assign(new Error(`connect ECONNREFUSED 10.0.0.9:6543`), { code: 'ECONNREFUSED' }),
    code: 'sdr_db_indisponivel',
  },
  {
    nome: 'teto de conexão do pool',
    erro: new Error('timeout exceeded when trying to connect'),
    code: 'sdr_db_indisponivel',
  },
  {
    nome: 'statement_timeout do servidor',
    erro: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
    code: 'sdr_db_timeout',
  },
  {
    nome: 'query_timeout do cliente',
    erro: new Error('Query read timeout'),
    code: 'sdr_db_timeout',
  },
  {
    nome: 'certificado não verificável',
    erro: Object.assign(new Error('self-signed certificate in certificate chain'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    }),
    code: 'sdr_db_tls',
  },
  {
    nome: 'senha recusada',
    erro: Object.assign(
      new Error(`password authentication failed for user "postgres.abcdefghijkl"`),
      { code: '28P01' },
    ),
    code: 'sdr_db_credenciais',
  },
  {
    nome: 'sem permissão',
    erro: Object.assign(new Error('permission denied for table leads'), { code: '42501' }),
    code: 'sdr_db_permissao',
  },
  {
    nome: 'tabela inexistente',
    erro: Object.assign(new Error('relation "leads" does not exist'), { code: '42P01' }),
    code: 'sdr_db_schema',
  },
  {
    nome: 'erro desconhecido',
    erro: new Error('alguma coisa que ninguém previu'),
    code: 'sdr_db_erro',
  },
  { nome: 'não é Error', erro: 'string solta', code: 'sdr_db_erro' },
  { nome: 'nulo', erro: null, code: 'sdr_db_erro' },
]

for (const caso of ERROS_DE_DRIVER) {
  test(`mapSdrDbError: ${caso.nome} → ${caso.code}`, () => {
    assert.equal(mapSdrDbError(caso.erro).code, caso.code)
  })
}

// Este é o critério P3: o que sai numa resposta não pode carregar detalhe interno.
const VAZAMENTOS = [
  SENHA, HOST, '6543', 'postgres.abcdefghijkl', '10.0.0.9',
  'ENOTFOUND', 'ECONNREFUSED', '57014', '28P01', '42501', '42P01',
  'getaddrinfo', 'pg_hba', 'statement timeout', 'authentication failed',
  'relation', 'certificate chain',
]

for (const caso of ERROS_DE_DRIVER) {
  test(`mapSdrDbError: ${caso.nome} não vaza nada para o usuário`, () => {
    const traduzido = mapSdrDbError(caso.erro)
    for (const agulha of VAZAMENTOS) {
      assert.ok(
        !traduzido.message.toLowerCase().includes(agulha.toLowerCase()),
        `mensagem vazou "${agulha}": ${traduzido.message}`,
      )
    }
    assert.ok(traduzido.message.length > 0)
    // A mensagem é em português e aponta o que fazer — não é o texto do driver.
    assert.notEqual(traduzido.message, (caso.erro as Error)?.message)
  })
}

test('mapSdrDbError guarda o erro original em cause, para o log do servidor', () => {
  const original = Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST}`), { code: 'ENOTFOUND' })
  const traduzido = mapSdrDbError(original)

  assert.equal(traduzido.cause, original)
  assert.equal(traduzido.name, 'SdrDbError')
})

test('mapSdrDbError não reembrulha um SdrDbError', () => {
  const erro = new SdrDbError('sdr_tls_desabilitado')
  assert.equal(mapSdrDbError(erro), erro)
})
