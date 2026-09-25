// Testes do fecho do ack (lib/sdr/regua-ack) contra Postgres DE VERDADE.
//
// O QUE NÃO SOBREVIVE A UM MOCK, e é por isso que aqui tem banco:
//
//   1. a GUARDA DE IDEMPOTÊNCIA do avanço. "Um segundo ack cria uma segunda linha da
//      fase seguinte?" só tem uma resposta autoritativa, e é a do Postgres avaliando o
//      `NOT EXISTS` dentro do INSERT. Uma imitação em JavaScript provaria a imitação —
//      e o defeito que ela esconderia é a campanha de alguém andando duas fases por
//      mensagem;
//   2. os PARÂMETROS SEM CAST, que existem para o Postgres deduzir o tipo da coluna de
//      destino numa base do cliente em que `id_fase` não é `integer`. É o analisador do
//      Postgres que aceita ou recusa isso, não o TypeScript;
//   3. o `UPDATE leads` amarrado por `EXISTS (SELECT 1 FROM proxima)` — uma CTE que
//      escreve lendo a saída de outra CTE que escreve. Também é regra de motor.
//
// SÃO DOIS BANCOS, e a distinção é a mesma de lib/sdr/regua.test:
//   · o do CLIENTE (`leads`, `lead_actions`, `campaign_config`) sobe CRU
//     (`comSchema: false`), com o DDL mínimo escrito aqui: essas tabelas não são do
//     schema da app;
//   · o da APP (`dispatch_claims`) sobe COM as migrações reais, como em
//     lib/sdr/reservas.test, porque é o índice único parcial da migração que faz o
//     `AND status = 'reservada'` da liquidação atingir uma linha só. É essa liquidação
//     que responde "este ack é o primeiro?", e testá-la contra um schema imitado seria
//     testar a imitação.
//
// O FUSO É O PONTO MAIS FÁCIL DE ERRAR SEM NINGUÉM VER: 09:00 em São Paulo é 12:00 em
// UTC, e um agendamento feito com `getHours()` ou com `Date.UTC` do dia UTC acerta o
// teste ingênuo e erra três horas na vida real — foi esse o defeito do fluxo do n8n. Por
// isso os instantes escolhidos aqui são justamente os em que os dois relógios discordam:
// 23:30 de Brasília (que já é o dia seguinte em UTC) e o agendamento que cai num mês
// adiante.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'
import { closeAllSdrPools, setSdrPoolFactory, type SdrPool } from '@/lib/sdr/pg'
import {
  DELAY_DIAS_PADRAO,
  avancarFase,
  concluirAck,
  lerCorpoDoAck,
  nomeDaFase,
  proximoDisparoSp,
} from '@/lib/sdr/regua-ack'
import { contarConsumidasHoje, registrarReservas } from '@/lib/sdr/reservas'
import { dispatchClaims, tenants } from '@/lib/db/schema'

/* String de conexão EXCLUSIVA deste arquivo. Os pools de lib/sdr/pg ficam num mapa de
 * módulo indexado pelo HASH da string: dois arquivos de teste com a mesma string
 * dividiriam o pool e, com a fábrica falsa, o mesmo PGlite. */
const CONN = 'postgresql://postgres.reguaack:S3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'

const TENANT = 'tenant-regua-ack'

const LEAD_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const LEAD_B = 'bbbbbbbb-2222-4222-8222-222222222222'

/* Quarta-feira, 12:00 em São Paulo (15:00 em UTC) — o instante "sem graça" contra o qual
 * as bordas de fuso são comparadas. */
const QUARTA_MEIO_DIA = new Date('2026-09-23T15:00:00Z')

/* 02:30 de quarta em UTC é 23:30 de TERÇA em São Paulo. É o instante que separa uma
 * conta de calendário local de uma conta feita no dia UTC: quem usar o dia UTC agenda
 * um dia adiante. */
const TERCA_QUASE_MEIA_NOITE = new Date('2026-09-23T02:30:00Z')

// As tabelas da base do CLIENTE. `leads` tem as colunas que lib/sdr/leads-write já
// documenta; aqui só `id` e `status` são usados, e `status` é o ponto do módulo.
const DDL_CLIENTE = `
  CREATE TABLE leads (
    id             uuid PRIMARY KEY,
    name           text,
    phone          text,
    phone_adjusted text,
    status         text
  );
  CREATE TABLE lead_actions (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id                   uuid NOT NULL,
    fase                      text,
    id_fase                   integer,
    ativo                     boolean,
    data_proxima_msg_outbound timestamptz
  );
  /* Só as colunas que este módulo lê, mais o \`updated_at\` que escolhe a linha
   * vigente. O DDL completo, DEFAULT por DEFAULT, está em lib/sdr/config-write.test —
   * repeti-lo aqui seria uma segunda cópia para sair de sincronia. */
  CREATE TABLE campaign_config (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delay_dias integer     NOT NULL DEFAULT 3,
    fase_final text        NOT NULL DEFAULT 'Template 10',
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`

let cliente: PGlite
let fecharCliente: () => Promise<void>
let app: BancoDeTeste

/** Todo SQL que chegou à base do cliente — é como se prova que um caminho NÃO consultou. */
let consultas: string[] = []

before(async () => {
  const cru = await bancoDeTeste({ comSchema: false })
  cliente = cru.pg
  fecharCliente = cru.fechar
  await cliente.exec(DDL_CLIENTE)

  // O banco DA APP, com as migrações reais — é dele que sai `dispatch_claims`.
  app = await bancoDeTeste()
  usarComoBancoDoApp(app.db)
  await app.db.insert(tenants).values({
    id: TENANT, name: 'Régua ack', slug: 'regua-ack', createdAt: new Date(),
  })

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
  await cliente.exec('TRUNCATE lead_actions; TRUNCATE leads; TRUNCATE campaign_config;')
  await app.pg.exec('TRUNCATE dispatch_claims;')
  consultas = []
})

// ─── Semeadura ────────────────────────────────────────────────────────────────

async function semearLead(id: string, status: string | null = null): Promise<void> {
  await cliente.query(
    'INSERT INTO leads (id, name, phone, status) VALUES ($1, $2, $3, $4)',
    [id, 'Ana Paula', '+5511999990000', status],
  )
}

/** Uma `lead_actions` JÁ RESERVADA pela régua: `ativo = false`, na fase que acabou de
 *  ser enviada. É esse o estado em que o ack encontra a linha. */
async function semearReservada(
  leadId: string,
  fase: string | null = 'Template 1',
  idFase: number | null = 1,
): Promise<string> {
  const rs = await cliente.query<{ id: string }>(
    `INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
     VALUES ($1, $2, $3, false, $4) RETURNING id`,
    [leadId, fase, idFase, QUARTA_MEIO_DIA.toISOString()],
  )
  return rs.rows[0].id
}

/** Uma `lead_actions` ATIVA — o lead que alguém inscreveu de novo no intervalo. */
async function semearAtiva(leadId: string, fase = 'Template 9'): Promise<string> {
  const rs = await cliente.query<{ id: string }>(
    `INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
     VALUES ($1, $2, 9, true, $3) RETURNING id`,
    [leadId, fase, QUARTA_MEIO_DIA.toISOString()],
  )
  return rs.rows[0].id
}

async function semearConfig(delayDias: number, updatedAt: Date, faseFinal = 'Template 5'): Promise<void> {
  await cliente.query(
    'INSERT INTO campaign_config (delay_dias, fase_final, updated_at) VALUES ($1, $2, $3)',
    [delayDias, faseFinal, updatedAt.toISOString()],
  )
}

type LinhaAcao = {
  id: string
  lead_id: string
  fase: string | null
  id_fase: number | string | null
  ativo: boolean | null
  data_proxima_msg_outbound: Date | null
}

async function acoesDoLead(leadId: string): Promise<LinhaAcao[]> {
  const rs = await cliente.query<LinhaAcao>(
    'SELECT * FROM lead_actions WHERE lead_id = $1 ORDER BY id_fase::text, id',
    [leadId],
  )
  return rs.rows
}

async function statusDoLead(id: string): Promise<string | null> {
  const rs = await cliente.query<{ status: string | null }>(
    'SELECT status FROM leads WHERE id = $1', [id],
  )
  return rs.rows[0]?.status ?? null
}

/** Registra no livro-caixa a reserva que a régua teria registrado. Sem ela a liquidação
 *  não tem o que liquidar, e `primeiroAck` sai `false` — que é o comportamento do envio
 *  que nunca passou por reserva (o fluxo antigo). */
async function semearReserva(acaoId: string, leadId: string, fase: string, idFase: number | null) {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [{ acaoId, leadId, fase, idFase }])
}

async function reservaDe(acaoId: string) {
  const [linha] = await app.db
    .select().from(dispatchClaims).where(eq(dispatchClaims.leadActionId, acaoId))
  return linha
}

/** O caminho completo: lead, config com intervalo de 3 dias, e a ação já reservada na
 *  fase 3, com o recibo no livro-caixa. */
async function cenarioEnviado(): Promise<string> {
  await semearLead(LEAD_A, 'Template 2')
  await semearConfig(3, QUARTA_MEIO_DIA)
  const acaoId = await semearReservada(LEAD_A, 'Template 3', 3)
  await semearReserva(acaoId, LEAD_A, 'Template 3', 3)
  return acaoId
}

// ─── Agendamento: 09:00 em São Paulo ──────────────────────────────────────────

test('o próximo disparo é 09:00 em São Paulo, que NÃO é 09:00 em UTC', () => {
  // Enviado quarta ao meio-dia de Brasília, com 3 dias de intervalo: sábado, 09:00 em
  // São Paulo — 12:00Z. O fluxo do n8n fixava 09:00 no fuso da instância dele, que em
  // UTC agendaria 09:00Z, ou seja, 06:00 da manhã para o lead.
  const quando = proximoDisparoSp(QUARTA_MEIO_DIA, 3)
  assert.equal(quando.toISOString(), '2026-09-26T12:00:00.000Z')
  assert.notEqual(quando.toISOString(), '2026-09-26T09:00:00.000Z')
})

test('o dia contado é o de SÃO PAULO, não o de UTC', () => {
  /* 02:30Z de quarta é 23:30 de TERÇA em São Paulo. Com 1 dia de intervalo, o próximo
   * disparo é quarta 09:00 SP (12:00Z). Quem contasse a partir do dia UTC (quarta)
   * agendaria quinta — um dia inteiro de atraso, meia hora por dia, para sempre. */
  const quando = proximoDisparoSp(TERCA_QUASE_MEIA_NOITE, 1)
  assert.equal(quando.toISOString(), '2026-09-23T12:00:00.000Z')
})

test('o intervalo atravessa mês sem aritmética própria', () => {
  const quando = proximoDisparoSp(new Date('2026-09-30T15:00:00Z'), 3)
  assert.equal(quando.toISOString(), '2026-10-03T12:00:00.000Z')
})

test('intervalo zero agenda para hoje às 09:00 — já vencido', () => {
  const quando = proximoDisparoSp(QUARTA_MEIO_DIA, 0)
  assert.equal(quando.toISOString(), '2026-09-23T12:00:00.000Z')
  assert.ok(quando < QUARTA_MEIO_DIA, 'nasce vencida: é o que "sem intervalo" significa')
})

test('nomeDaFase monta o nome que meta_templates_whatsapp guarda', () => {
  assert.equal(nomeDaFase(4), 'Template 4')
})

// ─── O avanço ─────────────────────────────────────────────────────────────────

test('o avanço cria UMA linha, na fase seguinte, ativa e agendada', async () => {
  const acaoId = await cenarioEnviado()

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'criada')
  assert.equal(avanco.proximaFase, 'Template 4')
  assert.equal(avanco.proximoIdFase, 4)
  assert.equal(avanco.delayDias, 3)
  assert.equal(avanco.delayPadrao, false)

  const linhas = await acoesDoLead(LEAD_A)
  assert.equal(linhas.length, 2, 'a reservada continua, mais a nova')

  // A reservada NÃO é reanimada: quem a desativou foi a reserva, e é assim que ela fica.
  const reservada = linhas.find(l => l.id === acaoId)
  assert.equal(reservada?.ativo, false)
  assert.equal(reservada?.fase, 'Template 3')

  const nova = linhas.find(l => l.id !== acaoId)
  assert.equal(nova?.fase, 'Template 4')
  assert.equal(Number(nova?.id_fase), 4)
  assert.equal(nova?.ativo, true)
  // 09:00 de sábado em São Paulo. A comparação é do INSTANTE, que é o que a coluna
  // `timestamptz` guarda — o teste falharia se o agendamento saísse em 09:00 UTC.
  assert.equal(nova?.data_proxima_msg_outbound?.toISOString(), '2026-09-26T12:00:00.000Z')
})

test('`leads.status` recebe a fase que ACABOU de sair — atrasa uma, de propósito', async () => {
  const acaoId = await cenarioEnviado()

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.statusGravado, true)
  assert.equal(avanco.faseEnviada, 'Template 3')

  /* O lead espera o Template 4 e o status diz Template 3. É o que o fluxo do n8n fazia,
   * e é DESVIO CONHECIDO no cabeçalho do módulo: a coluna é lida por relatório fora
   * deste repositório. Este teste prende o comportamento para a troca, quando o produto
   * decidir, ser uma decisão e não um efeito colateral. */
  assert.equal(await statusDoLead(LEAD_A), 'Template 3')
})

test('um SEGUNDO ack do mesmo envio não cria nada — a guarda inteira do módulo', async () => {
  const acaoId = await cenarioEnviado()

  const primeiro = await concluirAck(CONN, {
    acaoId, status: 'enviado', messageId: 'ycl-1', agora: QUARTA_MEIO_DIA,
  })
  assert.equal(primeiro.ok, true)
  assert.equal(primeiro.avanco?.motivo, 'criada')
  // GUARDA 2: o livro-caixa mudou uma linha, então ESTE é o primeiro ack.
  assert.equal(primeiro.liquidadas, 1)
  assert.equal(primeiro.primeiroAck, true)

  // O retry do n8n, minutos depois. Mesmo corpo, mesmo messageId.
  const segundo = await concluirAck(CONN, {
    acaoId, status: 'enviado', messageId: 'ycl-1', agora: new Date('2026-09-23T15:05:00Z'),
  })
  assert.equal(segundo.ok, true, 'repetir é rotina, não falha: o n8n não deve tentar para sempre')
  // GUARDA 1: o lead já tem ação ativa — a que o primeiro ack criou.
  assert.equal(segundo.avanco?.motivo, 'ja_tem_ativa')
  assert.equal(segundo.avanco?.proximaFase, null)
  // GUARDA 2: nada a liquidar, porque a reserva já saiu de voo.
  assert.equal(segundo.liquidadas, 0)
  assert.equal(segundo.primeiroAck, false)

  const linhas = await acoesDoLead(LEAD_A)
  assert.equal(linhas.length, 2, 'duas linhas: a reservada e UMA nova')
  assert.deepEqual(linhas.map(l => l.fase), ['Template 3', 'Template 4'])

  // A liquidação também não foi reescrita: o desfecho e o carimbo são do primeiro ack.
  const reserva = await reservaDe(acaoId)
  assert.equal(reserva.status, 'enviada')
  assert.equal(reserva.ycloudMessageId, 'ycl-1')
  assert.deepEqual(reserva.settledAt, QUARTA_MEIO_DIA)
})

test('lead inscrito no intervalo NÃO ganha uma segunda ação ativa', async () => {
  const acaoId = await cenarioEnviado()
  // Alguém inscreveu o lead à mão entre a reserva e o ack (a tela de leads faz isso).
  await semearAtiva(LEAD_A, 'Template 9')

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'ja_tem_ativa')

  const ativas = (await acoesDoLead(LEAD_A)).filter(l => l.ativo === true)
  assert.equal(ativas.length, 1, 'duas ações ativas é o lead recebendo duas mensagens por rodada')
  assert.equal(ativas[0].fase, 'Template 9')

  /* E o status NÃO foi escrito: o lead está em outra campanha agora, e marcá-lo com a
   * fase de uma régua que já não é a dele seria gravar uma frase falsa. */
  assert.equal(await statusDoLead(LEAD_A), 'Template 2', 'continua o que era')
})

test('a fase FINAL é ultrapassada: quem filtra é a seleção, não o ack', async () => {
  await semearLead(LEAD_A)
  // Fase final 5, lead terminando a 5. A régua nunca escolheria a linha nova
  // (`fase <> fase_final` deixa a 6 passar, mas a 6 não é a final... a 5 é que não
  // passa) — o ponto é que ESTE módulo não conhece `fase_final` e não decide nada com ela.
  await semearConfig(2, QUARTA_MEIO_DIA, 'Template 5')
  const acaoId = await semearReservada(LEAD_A, 'Template 5', 5)

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'criada')
  assert.equal(avanco.proximaFase, 'Template 6')

  const nova = (await acoesDoLead(LEAD_A)).find(l => l.fase === 'Template 6')
  assert.ok(nova, 'a linha existe, vencida e ativa — e a seleção simplesmente não a escolhe')
})

// ─── `delay_dias` ─────────────────────────────────────────────────────────────

test('sem linha em campaign_config o intervalo cai no padrão, e isso é DITO', async () => {
  await semearLead(LEAD_A)
  const acaoId = await semearReservada(LEAD_A, 'Template 1', 1)

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'criada')
  assert.equal(avanco.delayDias, DELAY_DIAS_PADRAO)
  // A bandeira é o ponto: agendar por palpite em silêncio é o que só aparece três dias
  // depois, quando a mensagem sai no dia errado.
  assert.equal(avanco.delayPadrao, true)

  const nova = (await acoesDoLead(LEAD_A)).find(l => l.fase === 'Template 2')
  assert.equal(nova?.data_proxima_msg_outbound?.toISOString(), '2026-09-26T12:00:00.000Z')
})

test('o intervalo vem da linha MAIS NOVA de campaign_config', async () => {
  await semearLead(LEAD_A)
  await semearConfig(10, new Date('2026-09-01T10:00:00Z'))
  await semearConfig(1, new Date('2026-09-20T10:00:00Z')) // a vigente
  const acaoId = await semearReservada(LEAD_A, 'Template 1', 1)

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.delayDias, 1)
  assert.equal(avanco.proximaEm?.toISOString(), '2026-09-24T12:00:00.000Z')
})

test('`delay_dias` como TEXTO é aceito — o schema do cliente não é nosso', async () => {
  /* O `pg` devolve `numeric`/`bigint`/`text` como string, e a coluna que num cliente é
   * `integer` pode ser outra coisa no próximo. Um `'2'` recusado por não ser `number`
   * agendaria pelo padrão em silêncio. */
  await cliente.exec('ALTER TABLE campaign_config ALTER COLUMN delay_dias TYPE text')
  try {
    await semearLead(LEAD_A)
    await cliente.query("INSERT INTO campaign_config (delay_dias) VALUES ('2')")
    const acaoId = await semearReservada(LEAD_A, 'Template 1', 1)

    const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
    assert.equal(avanco.delayDias, 2)
    assert.equal(avanco.delayPadrao, false)
  } finally {
    await cliente.exec(
      "ALTER TABLE campaign_config ALTER COLUMN delay_dias TYPE integer USING delay_dias::integer",
    )
  }
})

// ─── `id_fase` ────────────────────────────────────────────────────────────────

test('`id_fase` como TEXTO: o número sai da coluna, não do nome da fase', async () => {
  /* Dois problemas num teste, e os dois são do mundo real: a coluna pode não ser
   * `integer` (e aí o valor chega como string), e o INSERT do avanço não pode levar
   * `::int` em parâmetro nenhum — com cast, esta base derrubaria a instrução inteira. */
  await cliente.exec('ALTER TABLE lead_actions ALTER COLUMN id_fase TYPE text')
  try {
    await semearLead(LEAD_A)
    await semearConfig(3, QUARTA_MEIO_DIA)
    const rs = await cliente.query<{ id: string }>(
      `INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
       VALUES ($1, 'Follow-up curto', '7', false, $2) RETURNING id`,
      [LEAD_A, QUARTA_MEIO_DIA.toISOString()],
    )

    const avanco = await avancarFase(CONN, { acaoId: rs.rows[0].id, agora: QUARTA_MEIO_DIA })
    assert.equal(avanco.motivo, 'criada')
    // O nome da fase atual não tem número nenhum utilizável — `parseInt(fase.split(' ')[1])`
    // do fluxo antigo daria `NaN` e mandaria o lead para 'Template NaN'.
    assert.equal(avanco.proximaFase, 'Template 8')
    assert.equal(avanco.proximoIdFase, 8)

    const nova = (await acoesDoLead(LEAD_A)).find(l => l.fase === 'Template 8')
    assert.equal(String(nova?.id_fase), '8')
  } finally {
    await cliente.exec(
      'ALTER TABLE lead_actions ALTER COLUMN id_fase TYPE integer USING id_fase::integer',
    )
  }
})

test('`id_fase` ilegível PARA o avanço em vez de inventar fase', async () => {
  await semearLead(LEAD_A, 'Template 2')
  const acaoId = await semearReservada(LEAD_A, 'Template 3', null)

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'sem_id_fase')
  assert.equal(avanco.proximaFase, null)
  assert.equal(await acoesDoLead(LEAD_A).then(l => l.length), 1, 'nada foi criado')
  assert.equal(await statusDoLead(LEAD_A), 'Template 2', 'nem o status foi tocado')
})

test('ação apagada entre a reserva e o ack vira motivo, não exceção', async () => {
  await semearLead(LEAD_A)
  const avanco = await avancarFase(CONN, {
    acaoId: '99999999-9999-4999-8999-999999999999', agora: QUARTA_MEIO_DIA,
  })
  assert.equal(avanco.motivo, 'acao_ausente')
  assert.equal(avanco.delayPadrao, true, 'sem linha não há config para ler junto')
})

test('lead apagado: a fase avança e o status simplesmente não é gravado', async () => {
  // A linha de `lead_actions` sobrevive ao `leads` apagado — não há FK na base do
  // cliente. Tirar o lead da campanha por isso seria perder a inscrição por um dado que
  // volta; o que não dá é gravar status em quem não existe.
  await semearConfig(3, QUARTA_MEIO_DIA)
  const acaoId = await semearReservada(LEAD_B, 'Template 1', 1)

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'criada')
  assert.equal(avanco.statusGravado, false)
})

test('fase NULL na linha reservada: avança pelo id_fase e não apaga o status', async () => {
  await semearLead(LEAD_A, 'novo')
  await semearConfig(3, QUARTA_MEIO_DIA)
  const acaoId = await semearReservada(LEAD_A, null, 2)

  const avanco = await avancarFase(CONN, { acaoId, agora: QUARTA_MEIO_DIA })
  assert.equal(avanco.motivo, 'criada')
  assert.equal(avanco.proximaFase, 'Template 3')
  assert.equal(avanco.statusGravado, false)
  // Gravar NULL ou '' aqui apagaria o que a coluna tinha, por nada.
  assert.equal(await statusDoLead(LEAD_A), 'novo')
})

// ─── Falha de envio ───────────────────────────────────────────────────────────

test('envio que falhou devolve a reserva ao cliente E marca o livro-caixa', async () => {
  const acaoId = await cenarioEnviado()

  const fecho = await concluirAck(CONN, { acaoId, status: 'falhou', agora: QUARTA_MEIO_DIA })
  assert.equal(fecho.ok, true)
  assert.equal(fecho.devolvidas, 1)
  assert.equal(fecho.liquidadas, 1)
  assert.equal(fecho.avanco, null, 'a fase NÃO avança: a mensagem não chegou a ninguém')

  // São DUAS coisas diferentes, e as duas aconteceram.
  const linhas = await acoesDoLead(LEAD_A)
  assert.equal(linhas.length, 1, 'nenhuma fase nova')
  assert.equal(linhas[0].ativo, true, 'o lead volta para a fila, e será tentado de novo')
  assert.equal(linhas[0].fase, 'Template 3', 'na MESMA fase')

  const reserva = await reservaDe(acaoId)
  assert.equal(reserva.status, 'falhou', 'a tentativa fica registrada — é o que permite um disjuntor depois')
  assert.equal(reserva.ycloudMessageId, null)

  // E a falha NÃO gasta a cota do dia: `limite_diario` é teto de mensagens entregues a
  // pessoas, e esta não chegou a ninguém (ver STATUS_QUE_CONSOMEM em lib/sdr/reservas).
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 0)
})

test('falha repetida não reanima nada duas vezes', async () => {
  const acaoId = await cenarioEnviado()

  await concluirAck(CONN, { acaoId, status: 'falhou', agora: QUARTA_MEIO_DIA })
  const segundo = await concluirAck(CONN, {
    acaoId, status: 'falhou', agora: new Date('2026-09-23T15:05:00Z'),
  })
  assert.equal(segundo.ok, true)
  // A linha do cliente já está ativa (o `AND ativo = false` de `devolverReservas`) e a
  // reserva já saiu de voo (o `AND status = 'reservada'` da liquidação).
  assert.equal(segundo.devolvidas, 0)
  assert.equal(segundo.liquidadas, 0)

  const reserva = await reservaDe(acaoId)
  assert.deepEqual(reserva.settledAt, QUARTA_MEIO_DIA, 'o carimbo é do primeiro')
})

test('envio bem-sucedido consome a cota do dia; o ack repetido não consome de novo', async () => {
  const acaoId = await cenarioEnviado()

  await concluirAck(CONN, { acaoId, status: 'enviado', messageId: 'ycl-9', agora: QUARTA_MEIO_DIA })
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1)

  await concluirAck(CONN, { acaoId, status: 'enviado', messageId: 'ycl-9', agora: QUARTA_MEIO_DIA })
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1, 'uma reserva, uma cota')
})

test('ack de envio sem reserva registrada liquida zero, e isso não é erro', async () => {
  // O fluxo antigo não passa por reserva nenhuma. Zero linhas liquidadas é informação
  // (ver o comentário de `liquidar` em lib/sdr/reservas), não falha.
  await semearLead(LEAD_A)
  await semearConfig(3, QUARTA_MEIO_DIA)
  const acaoId = await semearReservada(LEAD_A, 'Template 1', 1)

  const fecho = await concluirAck(CONN, {
    acaoId, status: 'enviado', messageId: 'ycl-solto', agora: QUARTA_MEIO_DIA,
  })
  assert.equal(fecho.ok, true)
  assert.equal(fecho.liquidadas, 0)
  assert.equal(fecho.primeiroAck, false)
  assert.equal(fecho.avanco?.motivo, 'criada', 'a fase avança mesmo assim — o envio aconteceu')
})

test('avanço incompleto não vira `ok: true`', async () => {
  await semearLead(LEAD_A, 'Template 2')
  const acaoId = await semearReservada(LEAD_A, 'Template 3', null) // id_fase ilegível
  await semearReserva(acaoId, LEAD_A, 'Template 3', null)

  const fecho = await concluirAck(CONN, {
    acaoId, status: 'enviado', messageId: 'ycl-2', agora: QUARTA_MEIO_DIA,
  })
  /* O lead ficou sem ação ativa. A reserva É liquidada — a mensagem saiu de verdade e
   * fingir que não gastaria a cota duas vezes —, mas a resposta diz que o serviço não
   * terminou. É a única forma de alguém ficar sabendo. */
  assert.equal(fecho.ok, false)
  assert.equal(fecho.avanco?.motivo, 'sem_id_fase')
  assert.equal(fecho.liquidadas, 1)
})

test('etapa que falha no banco volta nomeada, sem derrubar a chamada', async () => {
  const acaoId = await cenarioEnviado()
  // A tabela que o avanço precisa sai de baixo dele. É o mais próximo de "o banco do
  // cliente caiu" que se consegue sem inventar um mock do pool.
  await cliente.exec('ALTER TABLE lead_actions RENAME TO lead_actions_guardada')
  try {
    const fecho = await concluirAck(CONN, {
      acaoId, status: 'enviado', messageId: 'ycl-3', agora: QUARTA_MEIO_DIA,
    })
    assert.equal(fecho.ok, false)
    assert.equal(fecho.etapa, 'avanco')
    assert.ok(fecho.falha, 'o erro cru viaja para o log, e não para a resposta')
    // A reserva NÃO foi liquidada: a ordem é avançar primeiro, e por isso o retry
    // encontra o serviço todo por fazer em vez de uma reserva fechada sem fase.
    assert.equal(fecho.liquidadas, 0)
    assert.equal((await reservaDe(acaoId)).status, 'reservada')
  } finally {
    await cliente.exec('ALTER TABLE lead_actions_guardada RENAME TO lead_actions')
  }
})

// ─── Leitura do corpo ─────────────────────────────────────────────────────────

test('corpo antigo, sem status e sem leadActionId, continua valendo', async () => {
  const leitura = lerCorpoDoAck({
    tenantId: TENANT, leadId: LEAD_A, messageId: 'ycl-1',
    phone: '+5511999990000', firstName: 'Ana', template: 'tpl', messageBody: 'Oi Ana',
  })
  assert.equal(leitura.ok, true)
  assert.ok(leitura.ok)
  // Status ausente é sucesso: o fluxo antigo só chama quando deu certo.
  assert.equal(leitura.ack.status, 'enviado')
  // Sem `leadActionId` o ack não avança fase nenhuma — quem avança é o fluxo antigo.
  assert.equal(leitura.ack.acaoId, null)
  assert.equal(leitura.ack.phone, '+5511999990000')
})

test('falha é aceita SEM messageId; sucesso sem messageId é recusado', () => {
  const falha = lerCorpoDoAck({
    tenantId: TENANT, leadId: LEAD_A, status: 'falhou',
    leadActionId: 'a-1', erro: 'template rejeitado',
  })
  assert.ok(falha.ok)
  assert.equal(falha.ack.status, 'falhou')
  assert.equal(falha.ack.messageId, null)
  assert.equal(falha.ack.erroDoEnvio, 'template rejeitado')

  const semId = lerCorpoDoAck({ tenantId: TENANT, leadId: LEAD_A, status: 'enviado' })
  assert.equal(semId.ok, false)
})

test('status desconhecido é recusado em vez de virar sucesso', () => {
  for (const ruim of ['failed', 'ENVIADO', 'ok', 'pendente']) {
    const leitura = lerCorpoDoAck({
      tenantId: TENANT, leadId: LEAD_A, messageId: 'x', status: ruim,
    })
    assert.equal(leitura.ok, false, `${ruim} não pode passar por 'enviado'`)
  }
})

test('tenantId e leadId continuam obrigatórios', () => {
  for (const corpo of [{}, { tenantId: TENANT }, { leadId: LEAD_A }, { tenantId: '  ', leadId: LEAD_A }]) {
    assert.equal(lerCorpoDoAck({ ...corpo, messageId: 'x' }).ok, false)
  }
  assert.equal(lerCorpoDoAck(null).ok, false)
})

test('os campos novos que não têm coluna são aceitos e ignorados', () => {
  /* `campanha`, `campaignId` e `sessionId` não têm onde cair, e `fase` tem dono: a fase
   * que vale é a da linha reservada, lida do banco. Aceitar sem usar é o que deixa o
   * disparador novo evoluir sem 400 — e é diferente de usar sem dizer. */
  const leitura = lerCorpoDoAck({
    tenantId: TENANT, leadId: LEAD_A, messageId: 'ycl-1', leadActionId: 'a-1',
    campanha: 'regua', campaignId: 'camp-7', sessionId: '5511999990000', fase: 'Template 1',
  })
  assert.ok(leitura.ok)
  assert.equal(leitura.ack.acaoId, 'a-1')
  assert.equal(Object.prototype.hasOwnProperty.call(leitura.ack, 'fase'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(leitura.ack, 'campaignId'), false)
})
