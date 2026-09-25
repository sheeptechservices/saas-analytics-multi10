// Testes da varredura (lib/sdr/varredura) contra Postgres DE VERDADE, nos DOIS bancos.
//
// SÃO DOIS, e a distinção é o assunto do módulo:
//   · o do CLIENTE (`leads`, `lead_actions`) sobe CRU (`comSchema: false`), com o DDL
//     mínimo escrito aqui — essas tabelas não são do schema da app. Entra pela fábrica de
//     pools de lib/sdr/pg, então o SQL de produção roda inteiro, sem o teste reescrever
//     nada;
//   · o da APP sobe COM AS MIGRAÇÕES REAIS de `drizzle/`, porque `dispatch_claims` e o
//     índice único parcial que a protege são do banco, não do TypeScript. Um schema
//     imitado provaria a imitação.
//
// O QUE NÃO SOBREVIVERIA A UM MOCK, e por isso está aqui:
//
//   1. a GUARDA. "O lead já tem ação ativa?" é uma pergunta de lógica de três valores
//      sobre `ativo` numa tabela que não é nossa, e a resposta autoritativa é a do
//      Postgres. Errar nela não dá erro nenhum: dá duas ações ativas para o mesmo lead,
//      ou seja, a mensagem duplicada que este diretório existe para eliminar;
//   2. a INVARIANTE do relatório, que é um `GROUP BY ... HAVING count(*) FILTER (...)`.
//      Um lead com `ativo` NULL, um lead sem linha nenhuma e um lead com linha ativa têm
//      de cair em três lugares diferentes, e isso é o planejador quem decide;
//   3. que o relatório NÃO ESCREVE. Está provado de duas formas independentes — o retrato
//      das tabelas do cliente antes e depois, e a conferência de que nenhum verbo de
//      escrita chegou a passar pelo pool.
//
// A ORDEM DAS DUAS GRAVAÇÕES não é testável aqui, e é melhor dizer do que deixar
// parecendo testada: ela só se manifesta quando o processo morre ENTRE as duas, e não há
// como matar o processo no meio de um teste que precisa sobreviver para conferir. O que
// os testes prendem é o RESULTADO das duas ordens possíveis ser diferente — o caminho
// bloqueado liquida sem reativar, o caminho normal faz as duas — e o raciocínio fica no
// cabeçalho de lib/sdr/varredura, onde ele pode ser lido por quem for trocar a ordem.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import { eq } from 'drizzle-orm'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'
import { closeAllSdrPools, setSdrPoolFactory, type SdrPool } from '@/lib/sdr/pg'
import { liquidarComoEnviada, registrarReservas } from '@/lib/sdr/reservas'
import {
  MAX_AMOSTRA,
  recuperarReservasParadas,
  relatarLeadsParados,
} from '@/lib/sdr/varredura'
import { dispatchClaims, tenants } from '@/lib/db/schema'

/* String de conexão EXCLUSIVA deste arquivo. Os pools de lib/sdr/pg ficam num mapa de
 * módulo indexado pelo HASH da string: dois arquivos de teste com a mesma string
 * compartilhariam o pool, e portanto o banco — e `npm test` roda os arquivos no mesmo
 * processo. */
const CONN = 'postgresql://postgres.varredura:S3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'

const TENANT = 'tenant-varredura'
const OUTRO_TENANT = 'tenant-vizinho-varredura'

const LEAD_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const LEAD_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const LEAD_C = 'cccccccc-3333-4333-8333-333333333333'
const LEAD_D = 'dddddddd-4444-4444-8444-444444444444'

/* Quarta-feira, 12:00 em São Paulo (15:00 em UTC) — o mesmo instante "sem graça" dos
 * outros testes do SDR. Aqui ele importa pouco (a varredura não tem janela de horário),
 * mas o balde do dia das reservas sai dele. */
const AGORA = new Date('2026-09-23T15:00:00Z')

/** Meia hora em voo é o prazo destes testes. Número do chamador, não do módulo. */
const PRAZO = 30 * 60 * 1000

/** O corte que o módulo calcula a partir de `AGORA` e `PRAZO` — recalculado aqui para a
 *  borda poder ser escolhida com precisão de milissegundo. */
const ANTES_DE = new Date(AGORA.getTime() - PRAZO)

// As tabelas da base do CLIENTE. `leads` vem com o conjunto COMPLETO de colunas que
// lib/sdr/leads-write escreve, e não com o mínimo de lib/sdr/regua.test: o relatório lê
// `leads.ativo`, e um DDL sem essa coluna esconderia a dependência até o dia em que ela
// aparecesse como `sdr_db_schema` na base de um cliente.
const DDL_CLIENTE = `
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
  );
  CREATE TABLE lead_actions (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id                   uuid NOT NULL,
    fase                      text,
    id_fase                   integer,
    ativo                     boolean,
    data_proxima_msg_outbound timestamptz
  );
`

let cliente: PGlite
let fecharCliente: () => Promise<void>
let app: BancoDeTeste

/** Todo SQL que chegou à base do CLIENTE pelo pool — é como se prova que uma chamada NÃO
 *  consultou, e que o relatório não escreve. As consultas de semeadura deste arquivo vão
 *  direto no PGlite e por isso não aparecem aqui. */
let consultas: string[] = []

before(async () => {
  const cru = await bancoDeTeste({ comSchema: false })
  cliente = cru.pg
  fecharCliente = cru.fechar
  await cliente.exec(DDL_CLIENTE)

  app = await bancoDeTeste()
  usarComoBancoDoApp(app.db)
  await app.db.insert(tenants).values([
    { id: TENANT, name: 'Varredura', slug: 'varredura', createdAt: new Date() },
    { id: OUTRO_TENANT, name: 'Vizinho', slug: 'vizinho-varredura', createdAt: new Date() },
  ])

  // A fábrica de pools de produção trocada por uma que fala com o PGlite do cliente. O
  // resto do caminho (buildSdrPoolConfig, cache, withSdrDb, tradução de erro) é real.
  setSdrPoolFactory(() => {
    const pool: SdrPool = {
      async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
        consultas.push(text)
        const rs = await cliente.query<R>(text, values as unknown[])
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
  soltarBancoDoApp()
  await fecharCliente()
  await app.fechar()
})

beforeEach(async () => {
  await cliente.exec('TRUNCATE lead_actions; TRUNCATE leads;')
  await app.pg.exec('TRUNCATE dispatch_claims;')
  consultas = []
})

// ─── Semeadura ────────────────────────────────────────────────────────────────

async function semearLead(
  id: string,
  opts: { ativo?: boolean | null; status?: string | null } = {},
): Promise<void> {
  await cliente.query(
    `INSERT INTO leads (id, name, phone, phone_adjusted, company, source, status, ativo, created_at)
     VALUES ($1, 'Ana Paula', '+5511999990000', '5511999990000', NULL, 'import', $2, $3, now())`,
    [id, opts.status ?? 'novo', opts.ativo === undefined ? true : opts.ativo],
  )
}

/**
 * Uma `lead_actions`. `ativo: false` é a linha RESERVADA (ou encerrada — são
 * indistinguíveis na base do cliente, que é o problema inteiro).
 *
 * `agendadaHa` é o quanto o agendamento é anterior a `AGORA`, como intervalo do Postgres:
 * é o que ordena a amostra do relatório.
 */
async function semearAcao(
  leadId: string,
  opts: { fase?: string | null; ativo?: boolean | null; agendadaHa?: string } = {},
): Promise<string> {
  const fase = opts.fase === undefined ? 'Template 1' : opts.fase
  const rs = await cliente.query<{ id: string }>(
    `INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
     VALUES ($1, $2, $3, $4, $5::timestamptz - ($6)::interval)
     RETURNING id::text AS id`,
    [
      leadId, fase, fase === null ? null : Number(/(\d+)/.exec(fase)?.[1] ?? 1),
      opts.ativo === undefined ? false : opts.ativo,
      AGORA.toISOString(), opts.agendadaHa ?? '1 hour',
    ],
  )
  return rs.rows[0].id
}

/** Registra o recibo de uma reserva no livro-caixa, carimbado em `quando`. Passa pelo
 *  `registrarReservas` de verdade — o formato do recibo é o que a régua grava. */
async function reservar(
  acaoId: string,
  leadId: string,
  quando: Date,
  tenantId: string = TENANT,
): Promise<void> {
  await registrarReservas(tenantId, quando, [{ acaoId, leadId, fase: 'Template 1', idFase: 1 }])
}

// ─── Leitura ──────────────────────────────────────────────────────────────────

async function acao(id: string): Promise<{ ativo: boolean | null; fase: string | null }> {
  const rs = await cliente.query<{ ativo: boolean | null; fase: string | null }>(
    'SELECT ativo, fase FROM lead_actions WHERE id = $1', [id],
  )
  return rs.rows[0]
}

async function recibo(acaoId: string) {
  const [linha] = await app.db
    .select().from(dispatchClaims).where(eq(dispatchClaims.leadActionId, acaoId))
  return linha
}

/**
 * O estado INTEIRO das duas tabelas do cliente, serializado. É assim que "o relatório não
 * escreveu nada" é provado sem confiar em nenhuma asserção campo a campo: se qualquer
 * coluna de qualquer linha mudar, a string muda.
 *
 * Vai direto no PGlite, e não pelo pool, para não sujar `consultas`.
 */
async function retratoDoCliente(): Promise<string> {
  const leads = await cliente.query(
    `SELECT id::text AS id, name, phone, phone_adjusted, company, source, status, ativo,
            created_at
       FROM leads ORDER BY id`,
  )
  const acoes = await cliente.query(
    `SELECT id::text AS id, lead_id::text AS lead_id, fase, id_fase, ativo,
            data_proxima_msg_outbound
       FROM lead_actions ORDER BY id`,
  )
  return JSON.stringify({ leads: leads.rows, acoes: acoes.rows })
}

/* Os verbos que o relatório não pode ter mandado. Conferir o TEXTO, e não só o efeito, é
 * o que pega uma escrita que por acaso não mudou nada nos dados semeados. */
const VERBO_DE_ESCRITA = /\b(insert|update|delete|truncate|alter|drop|create|merge)\b/i

// ─── Recuperação: o caminho normal ────────────────────────────────────────────

test('reserva parada volta nos DOIS bancos: ativo = true no cliente, devolvida no livro-caixa', async () => {
  await semearLead(LEAD_A)
  const acaoId = await semearAcao(LEAD_A, { ativo: false })
  await reservar(acaoId, LEAD_A, new Date(AGORA.getTime() - 60 * 60 * 1000))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 1)
  assert.equal(resultado.reativadas, 1)
  assert.equal(resultado.liquidadas, 1)
  assert.deepEqual(resultado.bloqueadas, [])
  assert.equal(resultado.antesDe.getTime(), ANTES_DE.getTime())

  // O CLIENTE: o lead voltou para a fila, na mesma fase e no mesmo agendamento.
  assert.equal((await acao(acaoId)).ativo, true)
  assert.equal((await acao(acaoId)).fase, 'Template 1')

  // O LIVRO-CAIXA: a reserva parou de gastar cota, com o carimbo do instante da rodada.
  const linha = await recibo(acaoId)
  assert.equal(linha.status, 'devolvida')
  assert.equal(linha.settledAt?.getTime(), AGORA.getTime())
})

test('reserva mais nova que o prazo fica em voo, e a base do cliente nem é aberta', async () => {
  await semearLead(LEAD_A)
  const acaoId = await semearAcao(LEAD_A, { ativo: false })
  await reservar(acaoId, LEAD_A, new Date(AGORA.getTime() - 10 * 60 * 1000))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 0)
  assert.equal(resultado.reativadas, 0)
  assert.equal(resultado.liquidadas, 0)

  assert.equal((await acao(acaoId)).ativo, false)
  assert.equal((await recibo(acaoId)).status, 'reservada')

  /* O caso comum de toda rodada de seleção é este, e ele tem de custar UMA consulta ao
   * banco da app e mais nada: a recuperação é para rodar antes de cada seleção, e abrir a
   * base do cliente à toa a tornaria caro demais para isso. */
  assert.deepEqual(consultas, [], 'não devia ter consultado a base do cliente')
})

test('a borda do prazo é EXCLUSIVA: na idade exata do prazo a reserva continua em voo', async () => {
  await semearLead(LEAD_A)
  await semearLead(LEAD_B)
  const naBorda = await semearAcao(LEAD_A, { ativo: false })
  const umMsAntes = await semearAcao(LEAD_B, { ativo: false })

  await reservar(naBorda, LEAD_A, ANTES_DE)
  await reservar(umMsAntes, LEAD_B, new Date(ANTES_DE.getTime() - 1))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  /* `claimed_at < antesDe`, estritamente menor. Um milissegundo de diferença decide, e a
   * folga aponta para o lado conservador de propósito: devolver cedo é como a mesma
   * pessoa recebe a mesma mensagem duas vezes — a linha volta para a fila enquanto o
   * envio original ainda está a caminho. Deixar em voo custa uma rodada de atraso. */
  assert.equal(resultado.paradas, 1)
  assert.equal(resultado.reativadas, 1)
  assert.equal((await acao(naBorda)).ativo, false, 'a reserva na borda não devia ter voltado')
  assert.equal((await acao(umMsAntes)).ativo, true)
  assert.equal((await recibo(naBorda)).status, 'reservada')
  assert.equal((await recibo(umMsAntes)).status, 'devolvida')
})

test('reserva já liquidada é ignorada: a varredura não desfaz um envio', async () => {
  await semearLead(LEAD_A)
  const acaoId = await semearAcao(LEAD_A, { ativo: false })
  await reservar(acaoId, LEAD_A, new Date(AGORA.getTime() - 2 * 60 * 60 * 1000))
  await liquidarComoEnviada(acaoId, 'wamid.TESTE', new Date(AGORA.getTime() - 110 * 60 * 1000))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 0)
  assert.deepEqual(consultas, [])
  // A linha do cliente é de um lead que JÁ RECEBEU: reativá-la seria mandar de novo.
  assert.equal((await acao(acaoId)).ativo, false)
  assert.equal((await recibo(acaoId)).status, 'enviada')
})

// ─── Recuperação: a guarda ────────────────────────────────────────────────────

test('A GUARDA: lead que já tem ação ativa tem o recibo liquidado e a linha NÃO reativada', async () => {
  /* O cenário: o ack avançou a fase (criou a `lead_actions` da fase 2, ATIVA) e falhou
   * ANTES de liquidar o livro-caixa. A reserva velha continua lendo 'reservada'.
   * Reativá-la daria ao lead DUAS ações ativas — a mensagem duplicada que este trabalho
   * vem removendo. */
  await semearLead(LEAD_A)
  const antiga = await semearAcao(LEAD_A, { fase: 'Template 1', ativo: false })
  const nova = await semearAcao(LEAD_A, { fase: 'Template 2', ativo: true, agendadaHa: '-2 days' })
  await reservar(antiga, LEAD_A, new Date(AGORA.getTime() - 60 * 60 * 1000))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 1)
  assert.equal(resultado.reativadas, 0, 'NADA podia ter sido reativado')
  assert.equal(resultado.liquidadas, 1, 'o recibo tinha de ser liquidado mesmo assim')
  assert.deepEqual(resultado.bloqueadas, [
    { acaoId: antiga, leadId: LEAD_A, motivo: 'lead_com_acao_ativa' },
  ])

  // O lead continua com UMA ação ativa: a nova. A velha ficou como estava.
  assert.equal((await acao(antiga)).ativo, false)
  assert.equal((await acao(nova)).ativo, true)

  /* Liquidado apesar de não reativado: deixá-lo 'reservada' faria toda varredura futura
   * reencontrar a mesma linha, gastando cota para sempre. */
  assert.equal((await recibo(antiga)).status, 'devolvida')

  const ativas = await cliente.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM lead_actions WHERE lead_id = $1 AND ativo = true', [LEAD_A],
  )
  assert.equal(ativas.rows[0].n, 1, 'o lead terminou com mais de uma ação ativa')
})

test('duas reservas paradas do MESMO lead: só a mais velha volta', async () => {
  /* A guarda vale dentro do lote também. Consultar o banco e ignorar o que a própria
   * varredura está a ponto de escrever seria a mesma duplicação, só mais difícil de ver:
   * as duas linhas voltariam e o lead ficaria com duas ações ativas. */
  await semearLead(LEAD_A)
  const maisVelha = await semearAcao(LEAD_A, { fase: 'Template 1', ativo: false })
  const maisNova = await semearAcao(LEAD_A, { fase: 'Template 2', ativo: false })
  await reservar(maisVelha, LEAD_A, new Date(AGORA.getTime() - 3 * 60 * 60 * 1000))
  await reservar(maisNova, LEAD_A, new Date(AGORA.getTime() - 60 * 60 * 1000))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 2)
  assert.equal(resultado.reativadas, 1)
  assert.equal(resultado.liquidadas, 2)
  assert.deepEqual(resultado.bloqueadas, [
    { acaoId: maisNova, leadId: LEAD_A, motivo: 'outra_reserva_do_mesmo_lead' },
  ])

  // Quem está parado há mais tempo é quem volta — a ordem de `listarReservasParadas`.
  assert.equal((await acao(maisVelha)).ativo, true)
  assert.equal((await acao(maisNova)).ativo, false)
})

test('recibo com id irreconhecível é liquidado sem chegar ao banco do cliente', async () => {
  /* `Descartado.leadId` da régua é `linha.lead_id ?? ''`: um descarte por `lead_ausente`
   * registra o recibo com `leadId` VAZIO, de propósito. Esse `''` num `''::uuid`
   * derrubaria a instrução inteira — e, como a varredura reencontraria a mesma linha a
   * cada rodada, derrubaria TODA varredura futura daquele tenant. */
  await semearLead(LEAD_A)
  const acaoId = await semearAcao(LEAD_A, { ativo: false })
  await reservar(acaoId, '', new Date(AGORA.getTime() - 60 * 60 * 1000))

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 1)
  assert.equal(resultado.reativadas, 0)
  assert.equal(resultado.liquidadas, 1)
  assert.deepEqual(resultado.bloqueadas, [
    { acaoId, leadId: '', motivo: 'id_irreconhecivel' },
  ])
  assert.deepEqual(consultas, [], 'um id malformado não podia ter virado parâmetro de SQL')
  assert.equal((await acao(acaoId)).ativo, false)
  assert.equal((await recibo(acaoId)).status, 'devolvida')
})

test('a recuperação é por tenant: a reserva do vizinho fica onde está', async () => {
  await semearLead(LEAD_A)
  await semearLead(LEAD_B)
  const minha = await semearAcao(LEAD_A, { ativo: false })
  const doVizinho = await semearAcao(LEAD_B, { ativo: false })
  const velho = new Date(AGORA.getTime() - 60 * 60 * 1000)
  await reservar(minha, LEAD_A, velho, TENANT)
  await reservar(doVizinho, LEAD_B, velho, OUTRO_TENANT)

  const resultado = await recuperarReservasParadas(CONN, {
    tenantId: TENANT, agora: AGORA, prazoMs: PRAZO,
  })

  assert.equal(resultado.paradas, 1)
  assert.equal((await acao(minha)).ativo, true)
  assert.equal((await recibo(minha)).status, 'devolvida')

  /* A reserva do vizinho não foi tocada em NENHUM dos dois bancos. Devolver a linha de
   * outro tenant exigiria a credencial dele, que não está nesta chamada — e liquidar o
   * recibo dele com esta credencial liberaria a linha lá sem nunca reativá-la, que é
   * exatamente o lead perdido em silêncio. */
  assert.equal((await acao(doVizinho)).ativo, false)
  assert.equal((await recibo(doVizinho)).status, 'reservada')
})

test('prazoMs zero, negativo ou não-numérico é RECUSADO, e nada é tocado', async () => {
  await semearLead(LEAD_A)
  const acaoId = await semearAcao(LEAD_A, { ativo: false })
  await reservar(acaoId, LEAD_A, new Date(AGORA.getTime() - 60 * 60 * 1000))

  /* Recusado, e não aparado para um valor seguro, porque não existe valor seguro nessa
   * direção: com o corte em `agora` ou no futuro, TODA reserva em voo parece parada e a
   * varredura devolveria o lote que o n8n está enviando neste instante. */
  for (const ruim of [0, -1, -PRAZO, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => recuperarReservasParadas(CONN, { tenantId: TENANT, agora: AGORA, prazoMs: ruim }),
      /prazoMs/,
      `prazoMs ${String(ruim)} devia ser recusado`,
    )
  }

  assert.equal((await acao(acaoId)).ativo, false)
  assert.equal((await recibo(acaoId)).status, 'reservada')
  assert.deepEqual(consultas, [])
})

// ─── Relatório: a invariante ──────────────────────────────────────────────────

test('o relatório acha o lead que só tem linha inativa', async () => {
  // Parado: duas linhas, nenhuma ativa.
  await semearLead(LEAD_A)
  await semearAcao(LEAD_A, { fase: 'Template 1', ativo: false, agendadaHa: '30 days' })
  await semearAcao(LEAD_A, { fase: 'Template 2', ativo: false, agendadaHa: '20 days' })

  const relatorio = await relatarLeadsParados(CONN, { limiteDaAmostra: 10 })

  assert.equal(relatorio.total, 1)
  assert.equal(relatorio.amostra.length, 1)
  assert.deepEqual(relatorio.amostra[0], {
    leadId: LEAD_A,
    acoesInativas: 2,
    // A fase da linha de agendamento mais RECENTE: onde a campanha parou.
    ultimaFase: 'Template 2',
    ultimoAgendamento: new Date(AGORA.getTime() - 20 * 24 * 60 * 60 * 1000),
    leadAtivo: true,
    temLead: true,
  })
})

test('o relatório NÃO conta lead com ação ativa, nem lead sem ação nenhuma', async () => {
  // Parado — é o único que devia aparecer.
  await semearLead(LEAD_A)
  await semearAcao(LEAD_A, { ativo: false })

  // Em campanha: tem linha ativa.
  await semearLead(LEAD_B)
  await semearAcao(LEAD_B, { ativo: true })

  // Tem linha ativa E linha inativa — está andando na régua, não está parado.
  await semearLead(LEAD_C)
  await semearAcao(LEAD_C, { fase: 'Template 1', ativo: false })
  await semearAcao(LEAD_C, { fase: 'Template 2', ativo: true })

  /* Sem `lead_actions` nenhuma: não está parado, está POR COMEÇAR. O `GROUP BY lead_id` o
   * deixa de fora sem precisar de cláusula — sem linha, não há grupo. Isto não é um
   * relatório de quem falta inscrever. */
  await semearLead(LEAD_D)

  const relatorio = await relatarLeadsParados(CONN, { limiteDaAmostra: 10 })

  assert.equal(relatorio.total, 1)
  assert.deepEqual(relatorio.amostra.map(l => l.leadId), [LEAD_A])
})

test('o relatório conta `ativo` NULL como parado, pelo filtro da própria régua', async () => {
  /* `SQL_RESERVAR` da régua filtra `a.ativo = true`, literal: em lógica de três valores,
   * `ativo` NULL não é `true` e a linha NUNCA é selecionada. Um lead cuja única linha está
   * assim está tão parado quanto um com `ativo = false` — e está parado pelo filtro que
   * decide quem recebe mensagem, que é a definição que importa. */
  await semearLead(LEAD_A)
  await semearAcao(LEAD_A, { ativo: null })

  const relatorio = await relatarLeadsParados(CONN, { limiteDaAmostra: 10 })

  assert.equal(relatorio.total, 1)
  assert.equal(relatorio.amostra[0].leadId, LEAD_A)
  assert.equal(relatorio.amostra[0].acoesInativas, 1)
})

test('o relatório NÃO ESCREVE NADA na base do cliente', async () => {
  /* A capacidade inteira depende disto. "Sem linha ativa" diz que o lead está parado; não
   * diz POR QUÊ — e reativar às cegas retomaria a campanha de quem pediu para parar.
   * Mandar WhatsApp para quem pediu para parar é o pior desfecho que este sistema
   * consegue produzir, então a função que não sabe o motivo não escreve. */
  await semearLead(LEAD_A)
  await semearLead(LEAD_B, { ativo: false })
  await semearAcao(LEAD_A, { fase: 'Template 1', ativo: false })
  await semearAcao(LEAD_A, { fase: 'Template 2', ativo: null })
  await semearAcao(LEAD_B, { ativo: false })
  // Uma linha ATIVA no meio: se o relatório escrevesse, é a que mais chamaria atenção.
  await semearLead(LEAD_C)
  await semearAcao(LEAD_C, { ativo: true })

  const antes = await retratoDoCliente()
  const relatorio = await relatarLeadsParados(CONN, { limiteDaAmostra: 10 })
  const depois = await retratoDoCliente()

  assert.equal(relatorio.total, 2)
  // Byte a byte: qualquer coluna de qualquer linha que mudasse muda a string.
  assert.equal(depois, antes, 'o relatório mudou a base do cliente')

  // E o texto, não só o efeito: uma escrita que por acaso não mudou nada também reprova.
  assert.ok(consultas.length > 0, 'o relatório não chegou a consultar nada')
  for (const sql of consultas) {
    assert.ok(!VERBO_DE_ESCRITA.test(sql), `o relatório mandou um verbo de escrita: ${sql}`)
  }
})

test('a amostra é limitada e ordenada por agendamento mais antigo; o total é o da base', async () => {
  /* A base do cliente tem ~60 mil leads: o relatório devolve contagem e AMOSTRA, nunca a
   * tabela. `total` é da base inteira e não do pedaço devolvido. */
  await semearLead(LEAD_A)
  await semearLead(LEAD_B)
  await semearLead(LEAD_C)
  await semearLead(LEAD_D)
  await semearAcao(LEAD_A, { ativo: false, agendadaHa: '10 days' })
  await semearAcao(LEAD_B, { ativo: false, agendadaHa: '40 days' })
  await semearAcao(LEAD_C, { ativo: false, agendadaHa: '20 days' })
  await semearAcao(LEAD_D, { ativo: false, agendadaHa: '30 days' })

  const dois = await relatarLeadsParados(CONN, { limiteDaAmostra: 2 })
  assert.equal(dois.total, 4)
  assert.equal(dois.limiteDaAmostra, 2)
  // Mais antigo primeiro: quem está parado há mais tempo é quem mais interessa.
  assert.deepEqual(dois.amostra.map(l => l.leadId), [LEAD_B, LEAD_D])

  /* Teto zero é pedido legítimo — "me dê só a contagem". A consulta devolve a linha-resumo
   * (`lead_id` NULL) e o total continua certo. */
  const soContagem = await relatarLeadsParados(CONN, { limiteDaAmostra: 0 })
  assert.equal(soContagem.total, 4)
  assert.deepEqual(soContagem.amostra, [])

  /* Pedido acima do teto é APARADO, ao contrário do `prazoMs`, que é recusado: amostra
   * grande demais é só consulta pesada, e ninguém recebe mensagem por causa dela. */
  const demais = await relatarLeadsParados(CONN, { limiteDaAmostra: MAX_AMOSTRA + 100 })
  assert.equal(demais.limiteDaAmostra, MAX_AMOSTRA)
  assert.equal(demais.total, 4)
  assert.equal(demais.amostra.length, 4)

  // Teto ilegível cai em zero, e não no teto inteiro: relatório não é exportação.
  const ilegivel = await relatarLeadsParados(
    CONN, { limiteDaAmostra: Number.NaN as unknown as number },
  )
  assert.equal(ilegivel.limiteDaAmostra, 0)
  assert.equal(ilegivel.total, 4)
})

test('`leads.ativo` viaja como pista e não como filtro', async () => {
  /* Não existe sinal de opt-out neste repositório — ver O QUE ACONTECE QUANDO ALGUÉM PEDE
   * PARA PARAR em lib/sdr/varredura. `leads.ativo` é a única candidata, a importação grava
   * `true` e nada aqui grava `false`: quem escreve é o n8n, que não está neste código.
   * Então a coluna SAI no relatório e NÃO entra no `WHERE` — usada como filtro, esconderia
   * lead genuinamente parado; ignorada, jogaria fora a única pista que há. */
  await semearLead(LEAD_A, { ativo: true })
  await semearLead(LEAD_B, { ativo: false })
  await semearLead(LEAD_C, { ativo: null })
  await semearAcao(LEAD_A, { ativo: false, agendadaHa: '10 days' })
  await semearAcao(LEAD_B, { ativo: false, agendadaHa: '20 days' })
  await semearAcao(LEAD_C, { ativo: false, agendadaHa: '30 days' })
  // `lead_actions` apontando para um `leads` que não existe mais: órfã do lado do cliente.
  await semearAcao(LEAD_D, { ativo: false, agendadaHa: '40 days' })

  const relatorio = await relatarLeadsParados(CONN, { limiteDaAmostra: 10 })

  // Nenhum dos quatro foi filtrado: o total é a contagem inteira.
  assert.equal(relatorio.total, 4)
  /* `comLeadInativo` é o tamanho da parte que merece mais desconfiança: tudo o que NÃO
   * está positivamente ativo — `false`, NULL, ou sem linha em `leads`. */
  assert.equal(relatorio.comLeadInativo, 3)

  assert.deepEqual(
    relatorio.amostra.map(l => ({ leadId: l.leadId, leadAtivo: l.leadAtivo, temLead: l.temLead })),
    [
      { leadId: LEAD_D, leadAtivo: null,  temLead: false },
      { leadId: LEAD_C, leadAtivo: null,  temLead: true  },
      { leadId: LEAD_B, leadAtivo: false, temLead: true  },
      { leadId: LEAD_A, leadAtivo: true,  temLead: true  },
    ],
  )
})

test('base sem lead parado devolve zero, não erro', async () => {
  await semearLead(LEAD_A)
  await semearAcao(LEAD_A, { ativo: true })

  const relatorio = await relatarLeadsParados(CONN, { limiteDaAmostra: 10 })

  /* "Nada a relatar" NUNCA é erro, pelo mesmo motivo de "nada a enviar" na régua: é um
   * zero com nome. A linha-resumo é a que garante que o total chegue mesmo sem amostra. */
  assert.equal(relatorio.total, 0)
  assert.equal(relatorio.comLeadInativo, 0)
  assert.deepEqual(relatorio.amostra, [])
})
