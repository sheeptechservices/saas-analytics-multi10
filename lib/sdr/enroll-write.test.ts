// Testes da inscrição de leads (lib/sdr/enroll-write) contra Postgres DE VERDADE.
//
// O que está sendo provado aqui não é JavaScript: é o comportamento de UMA instrução
// de INSERT com duas guardas e `jsonb_to_recordset`. Isso não sobrevive a um mock —
// a pergunta "o `NOT EXISTS` enxerga as linhas que esta mesma instrução inseriu?" só
// tem uma resposta autoritativa, que é a do Postgres. Por isso o PGlite (o Postgres
// compilado para WASM, o mesmo harness de lib/cron-lock.test.ts) entra pela fábrica
// de pools de lib/sdr/pg: o código de produção roda inteiro, sem que o teste reescreva
// o SQL dele aqui.
//
// `leads` e `lead_actions` são tabelas da base do CLIENTE, não do schema do app — por
// isso o banco sobe cru (`comSchema: false`) e o DDL mínimo delas mora aqui.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import { bancoDeTeste } from '@/test-support/pglite'
import { closeAllSdrPools, setSdrPoolFactory, type SdrPool } from '@/lib/sdr/pg'
import { InscricaoInvalida, inscreverLeads } from '@/lib/sdr/enroll-write'

// Passa por buildSdrPoolConfig (que exige postgres:// e TLS não desabilitado); o
// destino real é o PGlite da fábrica abaixo, então nada disto abre socket.
const CONN = 'postgresql://postgres.cliente:senha@db.abcdefghijkl.supabase.co:5432/postgres'

const LEAD_A = '11111111-1111-4111-8111-111111111111'
const LEAD_B = '22222222-2222-4222-8222-222222222222'
const LEAD_C = '33333333-3333-4333-8333-333333333333'
const SUMIDO = '99999999-9999-4999-8999-999999999999'

interface AcaoRow {
  lead_id:                   string
  fase:                      string | null
  id_fase:                   number | null
  ativo:                     boolean | null
  data_proxima_msg_outbound: Date | null
}

let pg: PGlite
let fechar: () => Promise<void>
/** Todo SQL que chegou ao banco — é como se prova que uma chamada NÃO consultou. */
let consultas: string[] = []

before(async () => {
  ;({ pg, fechar } = await bancoDeTeste({ comSchema: false }))

  await pg.exec(`
    CREATE TABLE leads (
      id   uuid PRIMARY KEY,
      name text
    );
    CREATE TABLE lead_actions (
      id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id                   uuid NOT NULL,
      fase                      text,
      id_fase                   integer,
      ativo                     boolean,
      data_proxima_msg_outbound timestamptz
    );
  `)

  // A fábrica de pools de produção trocada por uma que fala com o PGlite. O resto do
  // caminho (buildSdrPoolConfig, cache de pools, withSdrDb, tradução de erro) é o real.
  setSdrPoolFactory(() => {
    const pool: SdrPool = {
      async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
        consultas.push(text)
        const rs = await pg.query<R>(text, values as unknown[])
        return {
          rows:     rs.rows,
          rowCount: rs.affectedRows ?? rs.rows.length,
          command:  '',
          oid:      0,
          fields:   [],
        } as unknown as QueryResult<R>
      },
      async end() {},
      on() { return pool },
    }
    return pool
  })
})

after(async () => {
  await closeAllSdrPools()
  setSdrPoolFactory(null)
  await fechar()
})

beforeEach(async () => {
  await pg.exec('TRUNCATE lead_actions; TRUNCATE leads;')
  await pg.query('INSERT INTO leads (id, name) VALUES ($1, $2), ($3, $4), ($5, $6)', [
    LEAD_A, 'Ana', LEAD_B, 'Bruno', LEAD_C, 'Carla',
  ])
  consultas = []
})

async function acoes(): Promise<AcaoRow[]> {
  const rs = await pg.query<AcaoRow>(
    'SELECT lead_id, fase, id_fase, ativo, data_proxima_msg_outbound FROM lead_actions ORDER BY lead_id',
  )
  return rs.rows
}

// ─── O caminho feliz ──────────────────────────────────────────────────────────

test('lead que existe e não tem ação ativa entra, com ativo = true', async () => {
  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1' })

  assert.deepEqual(r, { inscritos: 1, leadIds: [LEAD_A] })

  const linhas = await acoes()
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].lead_id, LEAD_A)
  assert.equal(linhas[0].fase, 'Template 1')
  assert.equal(linhas[0].id_fase, 1)
  assert.equal(linhas[0].ativo, true)
})

test('vários leads numa chamada só: uma consulta, uma linha para cada', async () => {
  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A, LEAD_B, LEAD_C], fase: 'Template 1' })

  assert.equal(r.inscritos, 3)
  assert.deepEqual([...r.leadIds].sort(), [LEAD_A, LEAD_B, LEAD_C].sort())
  // O lote inteiro cabe numa instrução — não é um INSERT por lead, como no n8n.
  assert.equal(consultas.length, 1)
})

// ─── As duas guardas ──────────────────────────────────────────────────────────

test('lead que não existe em leads é PULADO — sem linha e sem erro', async () => {
  const r = await inscreverLeads(CONN, { leadIds: [SUMIDO], fase: 'Template 1' })

  assert.deepEqual(r, { inscritos: 0, leadIds: [] })
  assert.deepEqual(await acoes(), [])
})

test('um lead inexistente no meio do lote não derruba os outros', async () => {
  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A, SUMIDO, LEAD_B], fase: 'Template 1' })

  assert.equal(r.inscritos, 2)
  assert.ok(!r.leadIds.includes(SUMIDO))
  assert.deepEqual((await acoes()).map(l => l.lead_id), [LEAD_A, LEAD_B])
})

test('lead que já tem ação ATIVA é pulado — ninguém entra duas vezes na campanha', async () => {
  await pg.query(
    'INSERT INTO lead_actions (lead_id, fase, id_fase, ativo) VALUES ($1, $2, $3, true)',
    [LEAD_A, 'Template 3', 3],
  )

  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A, LEAD_B], fase: 'Template 1' })

  assert.deepEqual(r, { inscritos: 1, leadIds: [LEAD_B] })
  // A ação que já existia continua como estava: nada foi sobrescrito.
  const doA = (await acoes()).filter(l => l.lead_id === LEAD_A)
  assert.equal(doA.length, 1)
  assert.equal(doA[0].fase, 'Template 3')
})

test('ação com ativo NULL também não bloqueia — buraco conhecido, registrado de propósito', async () => {
  /* `NULL = true` não é true, então o `NOT EXISTS` não vê esta linha e a inscrição
   * passa: o lead termina com duas `lead_actions`, uma delas de estado indefinido.
   * Isto NÃO é um descuido a corrigir aqui — é exatamente o que o SQL do n8n fazia, e
   * mudar a guarda para `IS NOT FALSE` mudaria quem entra na campanha em bases que já
   * têm linhas assim. O teste existe para que a próxima pessoa encontre uma decisão
   * documentada em vez de uma surpresa. */
  await pg.query(
    'INSERT INTO lead_actions (lead_id, fase, id_fase, ativo) VALUES ($1, $2, $3, NULL)',
    [LEAD_A, 'Template 9', 9],
  )

  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1' })

  assert.equal(r.inscritos, 1)
  assert.equal((await acoes()).length, 2)
})

test('ação INATIVA não bloqueia: a guarda é sobre ativo = true', async () => {
  await pg.query(
    'INSERT INTO lead_actions (lead_id, fase, id_fase, ativo) VALUES ($1, $2, $3, false)',
    [LEAD_A, 'Template 9', 9],
  )

  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1' })

  assert.equal(r.inscritos, 1)
  assert.equal((await acoes()).length, 2)
})

// ─── A sutileza que só o Postgres responde ────────────────────────────────────

test('o MESMO id duas vezes na mesma chamada cria UMA linha, não duas', async () => {
  /* Dentro de uma instrução, o `NOT EXISTS (... ativo = true)` lê a tabela como ela
   * estava ANTES do INSERT — as linhas que esta mesma instrução insere não aparecem
   * para as outras. Sem a desduplicação em enroll-write, este teste veria DUAS ações
   * ativas para o mesmo lead, ou seja, duas conversas com a mesma pessoa.
   *
   * O que este teste NÃO prova: dois pedidos SIMULTÂNEOS com o mesmo lead — esses
   * gravam os dois, e só um índice único na base do cliente fecharia isso. Ver a nota
   * em `idsUnicos` (lib/sdr/enroll-write). */
  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A, LEAD_A, LEAD_A], fase: 'Template 1' })

  assert.deepEqual(r, { inscritos: 1, leadIds: [LEAD_A] })
  assert.equal((await acoes()).length, 1)
})

test('repetido com espaço em volta continua sendo o mesmo id', async () => {
  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A, `  ${LEAD_A}  `], fase: 'Template 1' })

  assert.equal(r.inscritos, 1)
  assert.equal((await acoes()).length, 1)
})

// ─── id_fase ──────────────────────────────────────────────────────────────────

test('fase "Template 7" grava id_fase = 7', async () => {
  await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 7' })

  const [linha] = await acoes()
  assert.equal(linha.fase, 'Template 7')
  assert.equal(linha.id_fase, 7)
})

test('fase sem dígito nenhum cai no padrão id_fase = 1', async () => {
  await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Boas-vindas' })

  const [linha] = await acoes()
  assert.equal(linha.fase, 'Boas-vindas')
  assert.equal(linha.id_fase, 1)
})

test('o primeiro número da fase é o que vale — como no fluxo antigo', async () => {
  await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 12 (v2)' })

  assert.equal((await acoes())[0].id_fase, 12)
})

// ─── agendarPara ──────────────────────────────────────────────────────────────

test('agendarPara em UTC chega ao banco como o mesmo instante', async () => {
  const quando = '2027-03-04T15:30:00.000Z'
  await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1', agendarPara: quando })

  const [linha] = await acoes()
  assert.equal(linha.data_proxima_msg_outbound?.toISOString(), quando)
})

test('agendarPara com fuso explícito guarda o instante, não a hora de parede', async () => {
  // 12:30 em -03:00 é 15:30 em UTC — o fuso de quem escreveu continua respeitado.
  await inscreverLeads(CONN, {
    leadIds: [LEAD_A], fase: 'Template 1', agendarPara: '2027-03-04T12:30:00-03:00',
  })

  const [linha] = await acoes()
  assert.equal(linha.data_proxima_msg_outbound?.toISOString(), '2027-03-04T15:30:00.000Z')
})

test('sem agendarPara, o agendamento é agora', async () => {
  const antes = Date.now()
  await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1' })
  const depois = Date.now()

  const gravado = (await acoes())[0].data_proxima_msg_outbound?.getTime() ?? 0
  assert.ok(
    gravado >= antes - 1_000 && gravado <= depois + 1_000,
    `esperava um horário de agora, veio ${new Date(gravado).toISOString()}`,
  )
})

test('agendarPara inválido é recusado ANTES de chegar ao banco', async () => {
  for (const ruim of ['ontem', '2026-13-45', '', '   ', '04/03/2027', '2027-03-04T99:00:00Z']) {
    await assert.rejects(
      () => inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1', agendarPara: ruim }),
      (err: unknown) => err instanceof InscricaoInvalida,
      `${ruim} devia ter sido recusado`,
    )
  }
  // Nenhuma dessas tentativas pode ter virado consulta — o valor ruim não pode chegar
  // ao Postgres nem para ele reclamar.
  assert.deepEqual(consultas, [])
  assert.deepEqual(await acoes(), [])
})

test('data que não existe no calendário é recusada — 30 de fevereiro NÃO vira 2 de março', async () => {
  /* O buraco que o `Date.parse` sozinho deixava passar: `new Date('2026-02-30')` não
   * falha, ele ROLA para 2026-03-02. O texto seguia para o Postgres, que é estrito,
   * e o 22008 dele voltava para a tela como "falha ao consultar a base do SDR" — o
   * banco pagando por um erro de digitação. Aqui a recusa é 400, e o dia digitado NÃO
   * é corrigido em silêncio: quem quis 30 de fevereiro precisa saber que não existe. */
  for (const ruim of ['2026-02-30', '2026-02-30T10:00:00Z', '2026-13-01', '2027-04-31', '2026-00-10']) {
    await assert.rejects(
      () => inscreverLeads(CONN, { leadIds: [LEAD_A], fase: 'Template 1', agendarPara: ruim }),
      (err: unknown) => err instanceof InscricaoInvalida,
      `${ruim} devia ter sido recusado`,
    )
  }
  assert.deepEqual(consultas, [])
  assert.deepEqual(await acoes(), [])
})

test('29 de fevereiro de ano bissexto continua passando', async () => {
  await inscreverLeads(CONN, {
    leadIds: [LEAD_A], fase: 'Template 1', agendarPara: '2028-02-29T08:00:00Z',
  })

  const [linha] = await acoes()
  assert.equal(linha.data_proxima_msg_outbound?.toISOString(), '2028-02-29T08:00:00.000Z')
})

// ─── Lote vazio ───────────────────────────────────────────────────────────────

test('lote vazio não consulta o banco', async () => {
  const r = await inscreverLeads(CONN, { leadIds: [], fase: 'Template 1' })

  assert.deepEqual(r, { inscritos: 0, leadIds: [] })
  assert.deepEqual(consultas, [])
})

test('lote só com lixo (não-texto e espaços) também não consulta', async () => {
  const sujo = [null, undefined, 42, '   ', ''] as unknown as string[]
  const r = await inscreverLeads(CONN, { leadIds: sujo, fase: 'Template 1' })

  assert.deepEqual(r, { inscritos: 0, leadIds: [] })
  assert.deepEqual(consultas, [])
})

// ─── Nada de SQL montado com texto ────────────────────────────────────────────

test('a fase vai como parâmetro: aspas no nome viram dado, não comando', async () => {
  const venenosa = `Template 1'); DROP TABLE lead_actions; --`

  const r = await inscreverLeads(CONN, { leadIds: [LEAD_A], fase: venenosa })

  assert.equal(r.inscritos, 1)
  assert.equal((await acoes())[0].fase, venenosa)
  // A tabela continua de pé, e nenhum valor apareceu no texto enviado.
  assert.equal(consultas.length, 1)
  assert.ok(!consultas[0].includes('DROP'))
  assert.ok(!consultas[0].includes(LEAD_A))
})
