// Testes da gravação de leads na base do cliente (lib/sdr/leads-write).
//
// Aqui o Postgres é de verdade: PGlite (o próprio Postgres em WASM) rodando dentro
// do processo de teste — mesmo analisador, mesmos tipos, mesmas regras de snapshot.
// É o único jeito de provar o que importa nesta instrução: `regexp_replace`,
// `NULLIF`/`COALESCE`, o CASE que só preenche coluna vazia, o NOT EXISTS que fecha a
// corrida de importações simultâneas, os caracteres que o analisador de JSON do
// Postgres recusa e o snapshot único das CTEs. Uma imitação em JavaScript não
// provaria nada disso.
//
// O que prende a instrução ÚNICA (e portanto a atomicidade) é a contagem de
// consultas do adaptador, no teste de INSERT + UPDATE na mesma chamada — nenhuma
// asserção sobre o conteúdo das linhas percebe uma implementação de duas instruções.
//
// A tabela `leads` é criada à mão, e não a partir de `drizzle/`: ela é da base do
// CLIENTE (Supabase), não do banco da app — o schema abaixo é o que o fluxo do n8n
// escrevia, coluna por coluna.
//
// O pool do lib/sdr/pg é trocado por um adaptador para o PGlite via
// `setSdrPoolFactory`, o mesmo portão de teste que lib/sdr/pg.test.ts usa. O
// adaptador guarda as consultas, que é como o teste de "entrada vazia não vai ao
// banco" consegue afirmar que nada foi perguntado.

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import {
  SdrDbError,
  closeAllSdrPools,
  setSdrPoolFactory,
  type SdrPool,
} from '@/lib/sdr/pg'
import { gravarLeads, type LeadNovo, type LeadUpdate } from '@/lib/sdr/leads-write'

const CONN = 'postgresql://postgres.abcdefghijkl:S3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'

// A tabela da base do cliente, como o n8n a escrevia.
const DDL_LEADS = `
  CREATE TABLE leads (
    id             uuid PRIMARY KEY,
    name           text,
    phone          text,
    phone_adjusted text,
    company        text,
    source         text,
    status         text,
    ativo          boolean,
    created_at     timestamptz
  )
`

type LinhaLead = {
  id:             string
  name:           string | null
  phone:          string | null
  phone_adjusted: string | null
  company:        string | null
  source:         string | null
  status:         string | null
  ativo:          boolean | null
}

interface PoolDeTeste extends SdrPool {
  consultas: Array<{ text: string; values?: unknown[] }>
}

let pg: PGlite
let pools: PoolDeTeste[]

/** Fábrica de pool que executa no PGlite. `falha` troca a consulta por um erro. */
function usarPglite(falha?: () => Error): PoolDeTeste[] {
  const criados: PoolDeTeste[] = []
  setSdrPoolFactory(() => {
    const pool: PoolDeTeste = {
      consultas: [],
      async query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: unknown[],
      ): Promise<QueryResult<R>> {
        pool.consultas.push({ text, values })
        if (falha) throw falha()
        const res = await pg.query<R>(text, values as unknown[])
        return {
          rows:     res.rows,
          rowCount: res.rows.length,
          command:  '',
          oid:      0,
          fields:   [],
        }
      },
      async end() {},
      on() { return pool },
    }
    criados.push(pool)
    return pool
  })
  return criados
}

/** Lê a tabela inteira, em ordem estável para as asserções. */
async function lerLeads(): Promise<LinhaLead[]> {
  const res = await pg.query<LinhaLead>(
    `SELECT id::text AS id, name, phone, phone_adjusted, company, source, status, ativo
       FROM leads ORDER BY phone_adjusted, id`,
  )
  return res.rows
}

/** Insere um lead JÁ existente, fora da função sob teste, e devolve o id. */
async function leadExistente(campos: Partial<LinhaLead> & { phone: string }): Promise<string> {
  const res = await pg.query<{ id: string }>(
    `INSERT INTO leads (id, name, phone, phone_adjusted, company, source, status, ativo, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, now())
     RETURNING id::text AS id`,
    [
      campos.name ?? null,
      campos.phone,
      campos.phone.replace(/\D/g, ''),
      campos.company ?? null,
      campos.source ?? null,
      campos.status ?? null,
    ],
  )
  return res.rows[0].id
}

function novo(over: Partial<LeadNovo> = {}): LeadNovo {
  return { name: '', phone: '+5511999990000', company: '', source: '', status: '', ...over }
}

function atualizacao(id: string, over: Partial<LeadUpdate> = {}): LeadUpdate {
  return { id, name: '', company: '', source: '', status: '', ...over }
}

before(async () => { pg = new PGlite() })
after(async () => { await pg.close() })

beforeEach(async () => {
  await pg.exec('DROP TABLE IF EXISTS leads')
  await pg.exec(DDL_LEADS)
  pools = usarPglite()
})

afterEach(async () => {
  await closeAllSdrPools()
  setSdrPoolFactory(null)
})

// ─── INSERT ───────────────────────────────────────────────────────────────────

test('cada lead novo vira uma linha e devolve um id', async () => {
  const entrada = [
    novo({ name: 'Ana',  phone: '+5511999990001' }),
    novo({ name: 'Bruno', phone: '+5511999990002' }),
    novo({ name: 'Carla', phone: '+5511999990003' }),
  ]

  const res = await gravarLeads(CONN, entrada, [])

  assert.equal(res.idsInseridos.length, 3, 'um id por linha da planilha')
  assert.equal(new Set(res.idsInseridos).size, 3, 'os ids não podem se repetir')
  assert.equal(res.atualizados, 0)

  const linhas = await lerLeads()
  assert.deepEqual(linhas.map(l => l.name), ['Ana', 'Bruno', 'Carla'])
  // Os ids devolvidos são os das linhas gravadas — a tela usa esses ids para
  // inscrever os leads logo em seguida; id que não existe no banco não inscreve nada.
  assert.deepEqual(
    [...res.idsInseridos].sort(),
    linhas.map(l => l.id).sort(),
  )
})

test('phone_adjusted é só os dígitos de phone, e ativo nasce true', async () => {
  await gravarLeads(CONN, [
    novo({ phone: '+55 (11) 99999-0001' }),
    novo({ phone: '+5511999990002' }),
  ], [])

  const linhas = await lerLeads()
  // O formato do phone_adjusted é contrato com o resto do produto (55 + DDD +
  // dígitos, sem '+'): mudar isto quebra a deduplicação e o disparo.
  assert.deepEqual(linhas.map(l => l.phone_adjusted), ['5511999990001', '5511999990002'])
  // E o `phone` continua exatamente como veio — só a coluna derivada é normalizada.
  assert.deepEqual(linhas.map(l => l.phone), ['+55 (11) 99999-0001', '+5511999990002'])
  assert.deepEqual(linhas.map(l => l.ativo), [true, true])
})

test('source e status vazios caem nos padrões import/novo', async () => {
  await gravarLeads(CONN, [
    novo({ phone: '+5511999990001', source: '',           status: '' }),
    novo({ phone: '+5511999990002', source: 'planilha-rh', status: 'qualificado' }),
  ], [])

  const linhas = await lerLeads()
  assert.deepEqual(linhas.map(l => l.source), ['import', 'planilha-rh'])
  assert.deepEqual(linhas.map(l => l.status), ['novo', 'qualificado'])
})

test('company vazia vira NULL, e company preenchida fica como veio', async () => {
  await gravarLeads(CONN, [
    novo({ phone: '+5511999990001', company: '' }),
    novo({ phone: '+5511999990002', company: 'Acme' }),
  ], [])

  const linhas = await lerLeads()
  assert.equal(linhas[0].company, null, 'string vazia tinha de virar NULL')
  assert.equal(linhas[1].company, 'Acme')
})

// ─── UPDATE ───────────────────────────────────────────────────────────────────

test('o update preenche só as colunas vazias e não toca nas preenchidas', async () => {
  const id = await leadExistente({
    phone: '+5511999990001',
    name: 'Nome Antigo',
    company: '',          // vazia → o update preenche
    source: 'landing',
    status: null,         // NULL também conta como vazia
  })

  const res = await gravarLeads(CONN, [], [
    atualizacao(id, { name: 'Nome Novo', company: 'Acme', source: 'planilha', status: 'qualificado' }),
  ])

  assert.equal(res.atualizados, 1)
  assert.deepEqual(res.idsInseridos, [])

  const [linha] = await lerLeads()
  // Dado que o cliente já tinha não é sobrescrito por planilha: a importação
  // completa o cadastro, não o reescreve.
  assert.equal(linha.name, 'Nome Antigo')
  assert.equal(linha.source, 'landing')
  assert.equal(linha.company, 'Acme')
  assert.equal(linha.status, 'qualificado')
})

test('campo vazio dos dois lados continua vazio — vira NULL, não string vazia', async () => {
  const id = await leadExistente({ phone: '+5511999990001', name: '', company: '' })

  await gravarLeads(CONN, [], [atualizacao(id)])

  const [linha] = await lerLeads()
  assert.equal(linha.name, null)
  assert.equal(linha.company, null)
})

test('update de id que não existe não conta como atualizado', async () => {
  const res = await gravarLeads(CONN, [], [
    atualizacao('00000000-0000-4000-8000-000000000000', { name: 'Fantasma' }),
  ])

  assert.equal(res.atualizados, 0)
  assert.deepEqual(await lerLeads(), [])
})

// ─── INSERT + UPDATE na mesma chamada ─────────────────────────────────────────

/* ESTE é o teste que prende a instrução única, e ele prende pela contagem de
 * consultas: com os DOIS lotes cheios, o banco pode receber UMA pergunta e só uma.
 * Quem separar o INSERT do UPDATE em duas instruções perde a transação implícita —
 * o Postgres confirmaria a primeira e poderia falhar na segunda, deixando leads
 * gravados e cadastros pela metade — e reprova aqui na hora. Os testes de "só
 * novos" e "só updates" não pegam isso: uma implementação de duas instruções que
 * pula o lote vazio passa nos dois. */
test('insere e atualiza numa instrução só, e cada contagem conta só o seu', async () => {
  const id = await leadExistente({ phone: '+5511999990001', name: '' })

  const res = await gravarLeads(
    CONN,
    [novo({ name: 'Bruno', phone: '+5511999990002' })],
    [atualizacao(id, { name: 'Ana' })],
  )

  assert.equal(res.idsInseridos.length, 1)
  assert.equal(res.atualizados, 1)
  assert.equal((await lerLeads()).length, 2)

  assert.equal(pools.length, 1, 'os dois lotes têm de caber numa conexão só')
  assert.equal(
    pools[0].consultas.length,
    1,
    'INSERT e UPDATE saíram em instruções separadas — a gravação deixou de ser atômica',
  )
  // E a única consulta leva os dois lotes: um SQL só com os dois $ é o que torna a
  // atomicidade possível; uma instrução que recebesse um lote só seria metade do
  // trabalho com a contagem inteira.
  const [consulta] = pools[0].consultas
  assert.equal(consulta.values?.length, 2, 'a instrução única tem de carregar $1 e $2')
  assert.equal(JSON.parse(String(consulta.values![0])).length, 1, '$1 é o lote de novos')
  assert.equal(JSON.parse(String(consulta.values![1])).length, 1, '$2 é o lote de updates')
})

/* O UPDATE CASA POR id, E POR NADA MAIS.
 *
 * O que este teste prova, exatamente: a linha que o INSERT acabou de criar não é
 * tocada pelo UPDATE, mesmo tendo name e company vazios (o alvo do CASE) e o MESMO
 * telefone do lead já cadastrado. Ela sai com o que o INSERT lhe deu. Quem "melhorar"
 * o UPDATE para casar por telefone em vez de id passa a sobrescrever a linha nova com
 * a atualização de outra, e reprova aqui.
 *
 * O que ele NÃO prova, apesar do nome antigo: o snapshot único das CTEs. Os ids
 * inseridos saem de `gen_random_uuid()` dentro da instrução, então nunca poderiam
 * aparecer no lote de $2 — separar o INSERT e o UPDATE em duas instruções não mudaria
 * nenhuma asserção daqui. A regra do snapshot é o teste logo abaixo; a instrução única
 * é o teste de contagem de consultas acima. */
test('o UPDATE não toca a linha que o INSERT criou — casa por id, não por telefone', async () => {
  const idExistente = await leadExistente({ phone: '+5511999990001', name: '', company: '' })

  const res = await gravarLeads(
    CONN,
    // Os dois ficam com name e company vazios: a linha nova é alvo do CASE do UPDATE
    // em tudo, menos no id. (Telefone igual ao do existente não serve mais para o
    // cenário — a guarda de corrida do INSERT recusa a segunda linha com os mesmos
    // dígitos, e isso tem teste próprio logo abaixo.)
    [novo({ phone: '+5511999990002', name: '', company: '' })],
    [atualizacao(idExistente, { name: 'Ana', company: 'Acme' })],
  )

  assert.equal(res.idsInseridos.length, 1)
  assert.equal(res.atualizados, 1, 'o UPDATE só podia ter tocado a linha pré-existente')

  const linhas = await lerLeads()
  assert.equal(linhas.length, 2)

  const inserida  = linhas.find(l => l.id === res.idsInseridos[0])!
  const existente = linhas.find(l => l.id === idExistente)!

  assert.equal(inserida.name, '', 'a linha inserida foi alcançada pelo UPDATE')
  assert.equal(inserida.company, null, 'a linha inserida foi alcançada pelo UPDATE')
  assert.equal(existente.name, 'Ana')
  assert.equal(existente.company, 'Acme')
})

/* A regra que o teste acima NÃO prova, aqui direto no Postgres — sem a função sob
 * teste no meio.
 * Serve de documentação executável: se um dia o PGlite (ou o Postgres) passar a
 * deixar uma CTE ver a escrita da outra, este teste avisa antes de o outro falhar
 * por um motivo que ninguém vai adivinhar. */
test('regra do Postgres: uma CTE não vê a escrita da outra na mesma instrução', async () => {
  const res = await pg.query<{ n: number | string }>(
    `WITH ins AS (
       INSERT INTO leads (id, phone, ativo, created_at)
       VALUES (gen_random_uuid(), '+5511999990001', true, now())
       RETURNING id
     )
     SELECT (SELECT count(*) FROM leads)::int AS n`,
  )

  assert.equal(Number(res.rows[0].n), 0, 'a CTE seguinte enxergou a linha recém-inserida')
  // Mas a escrita confirmou: a instrução inteira é uma transação só.
  assert.equal((await lerLeads()).length, 1)
})

// ─── Corrida: telefone que já está na base ────────────────────────────────────
//
// A rota lê para deduplicar e só depois grava. Entre as duas coisas cabe outra
// importação do mesmo arquivo: as duas veem o lead como ausente e as duas inserem —
// e o fluxo de disparo aborda a mesma pessoa duas vezes. Sem índice único na tabela
// do cliente (e não podemos criar um), a guarda é o NOT EXISTS do próprio INSERT.

test('lead cujos dígitos já estão na base não é inserido de novo', async () => {
  const idExistente = await leadExistente({ phone: '+5511999990001', name: 'Ana' })

  // Mesmo telefone, escrito de outro jeito: a guarda compara só os dígitos.
  const res = await gravarLeads(CONN, [novo({ name: 'Ana', phone: '+55 (11) 99999-0001' })], [])

  assert.deepEqual(res.idsInseridos, [], 'a linha pulada não pode voltar no RETURNING')

  const linhas = await lerLeads()
  assert.equal(linhas.length, 1, 'inseriu um segundo lead com o mesmo telefone')
  assert.equal(linhas[0].id, idExistente)
})

test('a contagem conta só o que entrou — a linha pulada não é "importada"', async () => {
  await leadExistente({ phone: '+5511999990001' })

  const res = await gravarLeads(CONN, [
    novo({ name: 'Ana',   phone: '+5511999990001' }),  // já existe → pulada
    novo({ name: 'Bruno', phone: '+5511999990002' }),  // nova
  ], [])

  // `importados` na tela é exatamente `idsInseridos.length`: se a linha pulada
  // entrasse na conta, o relatório diria que gravou um lead que não existe.
  assert.equal(res.idsInseridos.length, 1)

  const linhas = await lerLeads()
  assert.equal(linhas.length, 2)
  const inserida = linhas.find(l => l.id === res.idsInseridos[0])!
  assert.equal(inserida.name, 'Bruno', 'o id devolvido não é o da linha que entrou')
})

// ─── Caracteres que o Postgres não carrega ────────────────────────────────────
//
// Uma célula com byte NUL fazia `jsonb_to_recordset` estourar com SQLSTATE 22P05 —
// que nem está no mapa de lib/sdr/pg.ts, então virava "Falha ao consultar a base de
// dados do SDR" — e a planilha inteira ficava sem gravar, por um caractere que o
// operador não vê. Metade solta de par surrogate faz o mesmo por 22P02.

test('NUL numa célula não derruba a importação inteira', async () => {
  const res = await gravarLeads(CONN, [
    novo({ name: 'Ana\u0000Maria', phone: '+5511999990001' }),
    novo({ name: 'Bruno',          phone: '+5511999990002' }),
  ], [])

  assert.equal(res.idsInseridos.length, 2, 'uma célula ruim levou a planilha inteira junto')

  const linhas = await lerLeads()
  // Tirar é a única saída fiel: o Postgres não guarda esse byte em coluna text
  // (22021), então não existe valor equivalente para gravar no lugar.
  assert.deepEqual(linhas.map(l => l.name), ['AnaMaria', 'Bruno'])
})

test('surrogate solto também não derruba — e o resto do texto fica', async () => {
  const res = await gravarLeads(CONN, [
    novo({ name: 'Ana\uD800', company: 'Acme\uDC00', phone: '+5511999990001' }),
  ], [])

  assert.equal(res.idsInseridos.length, 1)
  const [linha] = await lerLeads()
  assert.equal(linha.name, 'Ana')
  assert.equal(linha.company, 'Acme')
})

test('o lote de updates passa pela mesma limpeza', async () => {
  const id = await leadExistente({ phone: '+5511999990001', name: '' })

  const res = await gravarLeads(CONN, [], [atualizacao(id, { name: 'Ana\u0000' })])

  assert.equal(res.atualizados, 1)
  assert.equal((await lerLeads())[0].name, 'Ana')
})

test('par surrogate legítimo (emoji) não é tocado', async () => {
  // A limpeza mira o que o Postgres não carrega, não o que é incomum: um emoji é
  // um par surrogate BEM formado e tem de chegar inteiro à base do cliente.
  await gravarLeads(CONN, [novo({ name: 'Ana 🎉', phone: '+5511999990001' })], [])

  assert.equal((await lerLeads())[0].name, 'Ana 🎉')
})

// ─── Entrada vazia ────────────────────────────────────────────────────────────

test('entrada vazia não vai ao banco e devolve zero', async () => {
  const res = await gravarLeads(CONN, [], [])

  assert.deepEqual(res, { idsInseridos: [], atualizados: 0 })
  // Nem consulta, nem pool: ida à base do cliente custa TCP + TLS e não há o que
  // gravar.
  assert.equal(pools.length, 0, 'criou pool para uma importação sem nada a gravar')
})

test('só novos, ou só updates, continuam indo ao banco', async () => {
  await gravarLeads(CONN, [novo({ phone: '+5511999990001' })], [])
  assert.equal(pools.length, 1)
  assert.equal(pools[0].consultas.length, 1, 'INSERT e UPDATE saem numa instrução só')

  const id = await leadExistente({ phone: '+5511999990002' })
  await gravarLeads(CONN, [], [atualizacao(id, { name: 'Ana' })])
  assert.equal(pools[0].consultas.length, 2)
})

test('os valores vão como parâmetro — nada é interpolado no SQL', async () => {
  const nomeHostil = "Ana'); DROP TABLE leads; --"
  await gravarLeads(CONN, [novo({ name: nomeHostil, phone: '+5511999990001' })], [])

  const [consulta] = pools[0].consultas
  assert.ok(!consulta.text.includes(nomeHostil), 'o valor apareceu dentro do texto do SQL')
  assert.equal(consulta.values?.length, 2, 'os dois lotes são $1 e $2')

  const linhas = await lerLeads()
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].name, nomeHostil)
})

// ─── Erro ─────────────────────────────────────────────────────────────────────

test('falha na consulta SOBE — não vira sucesso silencioso', async () => {
  usarPglite(() => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))

  await assert.rejects(
    () => gravarLeads(CONN, [novo({ phone: '+5511999990001' })], []),
    (err: unknown) =>
      err instanceof SdrDbError && err.code === 'sdr_db_indisponivel',
    'a gravação tem de estourar: dizer "importado" com o banco intacto é a pior falha possível',
  )

  // E nada foi gravado.
  assert.deepEqual(await lerLeads(), [])
})

test('a mensagem do erro não carrega a string de conexão nem texto do driver', async () => {
  usarPglite(() => Object.assign(
    new Error('password authentication failed for user "postgres.abcdefghijkl"'),
    { code: '28P01' },
  ))

  const erro = await gravarLeads(CONN, [], [atualizacao('00000000-0000-4000-8000-000000000000')])
    .then(() => null, (e: unknown) => e as SdrDbError)

  assert.ok(erro instanceof SdrDbError)
  assert.equal(erro.code, 'sdr_db_credenciais')
  for (const agulha of ['S3nh4', 'pooler.supabase.com', '6543', 'postgres.abcdefghijkl', '28P01']) {
    assert.ok(!erro.message.includes(agulha), `a mensagem vazou "${agulha}": ${erro.message}`)
  }
})
