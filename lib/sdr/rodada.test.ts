// Testes da rodada de disparo (lib/sdr/rodada) contra Postgres DE VERDADE, nos DOIS
// bancos — porque a rodada é, do começo ao fim, uma coreografia entre eles:
//
//   · o do CLIENTE (`leads`, `lead_actions`, `meta_templates_whatsapp`,
//     `campaign_config`) sobe CRU (`comSchema: false`), com o DDL mínimo escrito aqui:
//     essas tabelas não são do schema da app. Ele entra pela fábrica de pools de
//     lib/sdr/pg, então o SQL de produção roda inteiro, sem o teste reescrever nada;
//   · o da APP sobe COM AS MIGRAÇÕES REAIS de `drizzle/`, porque `dispatch_claims` e o
//     índice único parcial que a protege são do banco, não do TypeScript.
//
// O QUE ESTES TESTES PRENDEM, e por que nenhum deles sobreviveria a um mock:
//
//   1. QUE A COTA SAI DO LIVRO-CAIXA. Duas rodadas seguidas, antes de qualquer ack: a
//      segunda tem de bater no limite. Com a contagem antiga (`blast_recipients`, que só
//      o ack escreve) a segunda mandaria a cota inteira de novo — o limite do DIA virando
//      limite POR RODADA, que é o defeito que a régua veio matar no n8n. É o teste mais
//      importante deste arquivo;
//   2. QUE O DESCARTE VOLTA, dos dois lados, e por isso não come vaga do dia;
//   3. QUE O ENVIO RECUSADO DEVOLVE TUDO. Um soluço de rede não pode custar um lote
//      inteiro de leads, permanentemente;
//   4. QUE A RECUPERAÇÃO RODA ANTES da seleção — a prova é o lead recuperado sair NESTA
//      mesma rodada;
//   5. QUE A RECUPERAÇÃO FALHANDO NÃO ABORTA a rodada;
//   6. A FORMA DO PAYLOAD, campo por campo. `leadActionId` (e não `acaoId`) é o nome que
//      `lerCorpoDoAck` de lib/sdr/regua-ack lê de volta; divergir aqui não daria erro
//      nenhum, daria campanha que envia e nunca avança de fase.
//
// O DISPARADOR é uma porta neste arquivo, e é assim que ele é em produção também: a URL e
// o segredo do n8n ficam fechados na rota e não entram em lib/sdr/rodada. O teste guarda
// os payloads que passaram por ela — é assim que se prova que o disparador NÃO foi
// chamado quando não havia o que mandar.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import { asc, eq } from 'drizzle-orm'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'
import { closeAllSdrPools, setSdrPoolFactory, type SdrPool } from '@/lib/sdr/pg'
import { registrarReservas } from '@/lib/sdr/reservas'
import {
  executarRodada,
  fraseDoMotivo,
  type MotivoDaRodada,
  type PayloadDoDisparo,
  type PedidoDaRodada,
  type RespostaDoDisparador,
} from '@/lib/sdr/rodada'
import { dispatchClaims, tenants } from '@/lib/db/schema'

/* String de conexão EXCLUSIVA deste arquivo. Os pools de lib/sdr/pg ficam num mapa de
 * módulo indexado pelo HASH da string: dois arquivos de teste com a mesma string
 * compartilhariam o pool, e portanto o banco — e `npm test` roda os arquivos no mesmo
 * processo. */
const CONN = 'postgresql://postgres.rodada:S3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'

const TENANT = 'tenant-rodada'

const LEAD_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const LEAD_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

/* Quarta-feira, 12:00 em São Paulo (15:00 em UTC) — o mesmo instante "sem graça" dos
 * outros testes do SDR: dentro da janela padrão (seg–sex, 09:00–18:00) pelas duas
 * contas. */
const AGORA = new Date('2026-09-23T15:00:00Z')

const ACK_URL = 'https://app.exemplo.test/api/sdr/dispatch/ack'

// As tabelas da base do CLIENTE, como o fluxo do n8n as usa. `campaign_config` entra
// aqui (e não no DDL de lib/sdr/regua.test) porque é a rodada que a LÊ — a régua recebe
// a config já pronta.
const DDL_CLIENTE = `
  CREATE TABLE leads (
    id             uuid PRIMARY KEY,
    name           text,
    phone          text,
    phone_adjusted text
  );
  CREATE TABLE lead_actions (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id                   uuid NOT NULL,
    fase                      text,
    id_fase                   integer,
    ativo                     boolean,
    data_proxima_msg_outbound timestamptz
  );
  CREATE TABLE meta_templates_whatsapp (
    nome_template     text,
    mensagem_template text,
    fase_envio        text,
    rank_disparo      integer
  );
  CREATE TABLE campaign_config (
    id             serial PRIMARY KEY,
    ativo          boolean,
    remetente      text,
    limite_diario  integer,
    fase_final     text,
    horario_inicio text,
    horario_fim    text,
    dias_ativos    text,
    delay_dias     integer,
    updated_at     timestamptz
  );
`

let cliente: PGlite
let fecharCliente: () => Promise<void>
let app: BancoDeTeste

/** Os payloads que chegaram ao disparador. Lista vazia é como se prova que ele NÃO foi
 *  chamado — o que importa em toda rodada que não manda nada. */
let enviados: PayloadDoDisparo[] = []

/** O que a porta de envio responde. Trocado por teste para exercitar a recusa. */
let respostaDoDisparador: RespostaDoDisparador | (() => Promise<never>) = { ok: true, status: 200 }

before(async () => {
  const cru = await bancoDeTeste({ comSchema: false })
  cliente = cru.pg
  fecharCliente = cru.fechar
  await cliente.exec(DDL_CLIENTE)

  app = await bancoDeTeste()
  usarComoBancoDoApp(app.db)
  await app.db.insert(tenants).values([
    { id: TENANT, name: 'Rodada', slug: 'rodada', createdAt: new Date() },
  ])

  // A fábrica de pools de produção trocada por uma que fala com o PGlite do cliente. O
  // resto do caminho (buildSdrPoolConfig, cache, withSdrDb, tradução de erro) é real.
  setSdrPoolFactory(() => {
    const pool: SdrPool = {
      async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
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
  await cliente.exec(
    'TRUNCATE lead_actions; TRUNCATE leads; TRUNCATE meta_templates_whatsapp; TRUNCATE campaign_config;',
  )
  await app.pg.exec('TRUNCATE dispatch_claims;')
  enviados = []
  respostaDoDisparador = { ok: true, status: 200 }
})

// ─── Semeadura ────────────────────────────────────────────────────────────────

async function semearLead(id: string, nome: string, telefone: string): Promise<void> {
  await cliente.query(
    `INSERT INTO leads (id, name, phone, phone_adjusted) VALUES ($1, $2, $3, $4)`,
    [id, nome, telefone, telefone.replace(/\D/g, '')],
  )
}

/**
 * Uma `lead_actions`. `vencidaHa` é o quanto o agendamento é anterior a `AGORA` — é o
 * que ordena a fila quando a cota é menor que ela.
 */
async function semearAcao(
  leadId: string,
  opts: { fase?: string; ativo?: boolean; vencidaHa?: string } = {},
): Promise<string> {
  const fase = opts.fase ?? 'Template 1'
  const rs = await cliente.query<{ id: string }>(
    `INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
     VALUES ($1, $2, $3, $4, $5::timestamptz - ($6)::interval)
     RETURNING id::text AS id`,
    [
      leadId, fase, Number(/(\d+)/.exec(fase)?.[1] ?? 1),
      opts.ativo ?? true, AGORA.toISOString(), opts.vencidaHa ?? '1 hour',
    ],
  )
  return rs.rows[0].id
}

async function semearTemplate(fase: string, nome: string, corpo: string): Promise<void> {
  await cliente.query(
    `INSERT INTO meta_templates_whatsapp (nome_template, mensagem_template, fase_envio, rank_disparo)
     VALUES ($1, $2, $3, 1)`,
    [nome, corpo, fase],
  )
}

/** A configuração que a tela de Parâmetros grava, com tudo preenchido. */
async function semearConfig(mudancas: Record<string, unknown> = {}): Promise<void> {
  const cfg = {
    ativo: true,
    remetente: 'Equipe Multi10',
    limite_diario: 10,
    fase_final: 'Template 5',
    horario_inicio: '09:00',
    horario_fim: '18:00',
    dias_ativos: '1,2,3,4,5',
    ...mudancas,
  }
  await cliente.query(
    `INSERT INTO campaign_config
       (ativo, remetente, limite_diario, fase_final, horario_inicio, horario_fim,
        dias_ativos, delay_dias, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 3, now())`,
    [
      cfg.ativo, cfg.remetente, cfg.limite_diario, cfg.fase_final,
      cfg.horario_inicio, cfg.horario_fim, cfg.dias_ativos,
    ],
  )
}

/** O cenário comum: um lead devido, com template, e a campanha ligada. */
async function cenarioSimples(): Promise<string> {
  await semearConfig()
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  return semearAcao(LEAD_A)
}

// ─── A rodada, com a porta de envio deste arquivo ─────────────────────────────

function pedido(extra: Partial<PedidoDaRodada> = {}): PedidoDaRodada {
  return {
    tenantId: TENANT,
    agora: AGORA,
    ackUrl: ACK_URL,
    async enviarLote(payload) {
      enviados.push(payload)
      if (typeof respostaDoDisparador === 'function') return respostaDoDisparador()
      return respostaDoDisparador
    },
    ...extra,
  }
}

const rodar = (extra: Partial<PedidoDaRodada> = {}) => executarRodada(CONN, pedido(extra))

// ─── Leitura ──────────────────────────────────────────────────────────────────

async function acao(id: string): Promise<{ ativo: boolean | null }> {
  const rs = await cliente.query<{ ativo: boolean | null }>(
    'SELECT ativo FROM lead_actions WHERE id = $1', [id],
  )
  return rs.rows[0]
}

async function recibos() {
  return app.db
    .select({ acaoId: dispatchClaims.leadActionId, status: dispatchClaims.status })
    .from(dispatchClaims)
    .orderBy(asc(dispatchClaims.claimedAt), asc(dispatchClaims.id))
}

async function recibosDe(acaoId: string) {
  return app.db
    .select({ status: dispatchClaims.status })
    .from(dispatchClaims)
    .where(eq(dispatchClaims.leadActionId, acaoId))
}

// ─── O caminho feliz, e a forma do payload ────────────────────────────────────

test('o lote sai pronto para o disparador, com o recibo da reserva em cada destinatário', async () => {
  const acaoId = await cenarioSimples()

  const resultado = await rodar()

  assert.equal(resultado.ok, true)
  assert.equal(resultado.motivo, 'ok')
  assert.equal(resultado.enviados, 1)
  assert.equal(resultado.reservadas, 1)
  assert.deepEqual(resultado.descartados, [])

  assert.equal(enviados.length, 1)
  const payload = enviados[0]
  assert.equal(payload.tenantId, TENANT)
  assert.equal(payload.campanha, 'regua')
  assert.equal(payload.remetente, 'Equipe Multi10')
  assert.equal(payload.ackUrl, ACK_URL)
  assert.deepEqual(payload.recipients, [{
    leadId: LEAD_A,
    phone: '+5511999990000',
    first_name: 'Ana',
    message: 'Oi Ana, tudo bem?',
    session_id: '5511999990000',
    template: 'boas_vindas',
    // O nome que o ack lê de volta. Ver lerCorpoDoAck em lib/sdr/regua-ack.
    leadActionId: acaoId,
    fase: 'Template 1',
  }])

  // A linha ficou reservada dos dois lados: `ativo = false` no cliente, recibo em voo
  // no livro-caixa. É o par que faz a cota enxergar o envio antes de o ack chegar.
  assert.equal((await acao(acaoId)).ativo, false)
  assert.deepEqual(await recibos(), [{ acaoId, status: 'reservada' }])
})

test('a contagem do dia sai marcada como incompleta enquanto o cron antigo existir', async () => {
  await cenarioSimples()

  const resultado = await rodar()

  // O que o cron antigo manda não aparece em NENHUM dos dois lugares que a app conta,
  // então `enviadosHoje` é um PISO. A tela tem de poder dizer isso.
  assert.equal(resultado.limite?.incompleta, true)
  assert.equal(resultado.limite?.limiteDiario, 10)
  assert.equal(resultado.limite?.enviadosHoje, 0)
  assert.equal(resultado.limite?.disponivel, 10)
})

// ─── A cota ───────────────────────────────────────────────────────────────────

test('a cota do dia sai do livro-caixa: a reserva EM VOO já conta, sem ack nenhum', async () => {
  // Duas linhas devidas e limite de UMA por dia. A primeira rodada manda uma; a segunda
  // não pode mandar nada, mesmo sem ack — a reserva em voo já comprometeu a vaga.
  //
  // Com a contagem antiga (`blast_recipients`, escrita só pelo ack) a segunda rodada
  // veria "zero enviados hoje" e mandaria a outra: o limite do DIA viraria limite POR
  // RODADA. É este teste que prende `contarConsumidasHoje` no lugar da porta.
  await semearConfig({ limite_diario: 1 })
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno Lima', '+5511888880000')
  await semearAcao(LEAD_A, { vencidaHa: '3 hours' })
  const acaoB = await semearAcao(LEAD_B, { vencidaHa: '1 hour' })

  const primeira = await rodar()
  assert.equal(primeira.enviados, 1)
  assert.equal(primeira.limite?.disponivel, 1)

  const segunda = await rodar()
  assert.equal(segunda.ok, false)
  assert.equal(segunda.motivo, 'limite_diario_atingido')
  assert.equal(segunda.enviados, 0)
  assert.equal(segunda.reservadas, 0)
  assert.equal(segunda.limite?.enviadosHoje, 1)
  assert.equal(segunda.limite?.disponivel, 0)

  // O disparador foi chamado UMA vez; o lead que sobrou continua na fila, intacto.
  assert.equal(enviados.length, 1)
  assert.equal((await acao(acaoB)).ativo, true)
})

// ─── Descarte ─────────────────────────────────────────────────────────────────

test('o descarte é registrado no livro-caixa e devolvido na hora, dos dois lados', async () => {
  // O lead B está numa fase sem template cadastrado: a régua RESERVA a linha dele (é a
  // mesma instrução que seleciona) e depois a descarta. Registrar esse descarte é o que
  // torna a linha recuperável se o processo morrer antes da devolução; devolvê-la em
  // seguida é o que impede a reserva de comer uma vaga do dia inteiro.
  await semearConfig()
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno Lima', '+5511888880000')
  const acaoA = await semearAcao(LEAD_A, { vencidaHa: '3 hours' })
  const acaoB = await semearAcao(LEAD_B, { fase: 'Template 2', vencidaHa: '1 hour' })

  const resultado = await rodar()

  assert.equal(resultado.ok, true)
  assert.equal(resultado.enviados, 1)
  assert.equal(resultado.reservadas, 2)
  assert.deepEqual(resultado.descartados, [
    { acaoId: acaoB, leadId: LEAD_B, fase: 'Template 2', motivo: 'template_ausente' },
  ])
  assert.deepEqual(resultado.devolvidas, { naBaseDoCliente: 1, noLivroCaixa: 1 })

  // O enviado segue em voo; o descartado voltou para a fila nos DOIS lugares.
  assert.deepEqual(await recibosDe(acaoA), [{ status: 'reservada' }])
  assert.deepEqual(await recibosDe(acaoB), [{ status: 'devolvida' }])
  assert.equal((await acao(acaoB)).ativo, true)

  // E o descarte devolvido NÃO gasta a vaga: a cota de hoje enxerga só o que está em voo.
  assert.equal(resultado.limite?.enviadosHoje, 0)
})

test('reservou, descartou tudo e não chamou o disparador — com o motivo de cada descarte', async () => {
  await semearConfig()
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  const acaoA = await semearAcao(LEAD_A) // nenhum template cadastrado

  const resultado = await rodar()

  assert.equal(resultado.ok, false)
  assert.equal(resultado.motivo, 'todos_descartados')
  assert.equal(resultado.enviados, 0)
  assert.equal(resultado.descartados.length, 1)
  assert.equal(resultado.descartados[0].motivo, 'template_ausente')
  assert.equal(enviados.length, 0)
  assert.equal((await acao(acaoA)).ativo, true)
})

// ─── Envio recusado ───────────────────────────────────────────────────────────

test('disparador que recusa devolve o lote INTEIRO, dos dois lados', async () => {
  const acaoId = await cenarioSimples()
  respostaDoDisparador = { ok: false, status: 502, erro: 'o disparador respondeu 502' }

  const resultado = await rodar()

  assert.equal(resultado.ok, false)
  assert.equal(resultado.motivo, 'envio_falhou')
  assert.equal(resultado.enviados, 0)
  assert.equal(resultado.statusDoEnvio, 502)
  assert.deepEqual(resultado.devolvidas, { naBaseDoCliente: 1, noLivroCaixa: 1 })

  // Sem esta devolução, um soluço de rede tiraria o lead da campanha para sempre.
  assert.equal((await acao(acaoId)).ativo, true)
  assert.deepEqual(await recibosDe(acaoId), [{ status: 'devolvida' }])
})

test('porta de envio que LEVANTA tem o mesmo desfecho de uma que recusa', async () => {
  const acaoId = await cenarioSimples()
  respostaDoDisparador = async () => { throw new Error('socket hang up') }

  const resultado = await rodar()

  assert.equal(resultado.motivo, 'envio_falhou')
  assert.equal(resultado.erroDoEnvio, 'socket hang up')
  assert.equal((await acao(acaoId)).ativo, true)
  assert.deepEqual(await recibosDe(acaoId), [{ status: 'devolvida' }])
})

// ─── Recuperação ──────────────────────────────────────────────────────────────

test('a recuperação roda ANTES da seleção: o lead parado volta a tempo de sair na mesma rodada', async () => {
  await semearConfig()
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  // Uma rodada anterior reservou e morreu: a linha ficou inativa no cliente e o recibo
  // ficou em voo há duas horas.
  const acaoId = await semearAcao(LEAD_A, { ativo: false })
  await registrarReservas(TENANT, new Date(AGORA.getTime() - 2 * 60 * 60 * 1000), [
    { acaoId, leadId: LEAD_A, fase: 'Template 1', idFase: 1 },
  ])

  const resultado = await rodar()

  assert.equal(resultado.recuperacao.estado, 'ok')
  assert.deepEqual(resultado.recuperacao, {
    estado: 'ok', paradas: 1, reativadas: 1, liquidadas: 1, bloqueadas: 0,
  })
  // A prova de que a recuperação veio primeiro: o mesmo lead saiu NESTA rodada.
  assert.equal(resultado.enviados, 1)
  assert.equal(enviados[0].recipients[0].leadActionId, acaoId)

  // Dois recibos para a mesma ação: o velho devolvido e o novo em voo. O índice único é
  // parcial justamente para permitir isto.
  assert.deepEqual(
    (await recibosDe(acaoId)).map(r => r.status).sort(),
    ['devolvida', 'reservada'],
  )
})

test('recuperação que falha NÃO aborta a rodada — a cota continua conferida do mesmo jeito', async () => {
  // `prazoMs` zero é recusado por lib/sdr/varredura (poria o corte em `agora` e faria
  // TODA reserva em voo parecer parada). Serve aqui como a maneira mais limpa de derrubar
  // só a recuperação, sem tocar em mais nada.
  await cenarioSimples()

  const resultado = await rodar({ prazoDeVooMs: 0 })

  assert.deepEqual(resultado.recuperacao, { estado: 'falhou' })
  assert.notEqual(resultado.falhaDaRecuperacao, undefined)
  // A rodada seguiu: a dívida que a recuperação paga é de rodadas ANTERIORES, e a cota —
  // que é o que não pode seguir às cegas — tem portão próprio na régua.
  assert.equal(resultado.ok, true)
  assert.equal(resultado.enviados, 1)
  assert.equal(resultado.limite?.enviadosHoje, 0)
})

// ─── Nada a enviar: sempre com motivo ─────────────────────────────────────────

test('sem linha em campaign_config o motivo é config_ausente, e não "campanha inativa"', async () => {
  // Sem linha nenhuma, `ativo !== true` é verdade e a régua diria "campanha inativa" —
  // mandando o operador procurar um interruptor numa tela que ainda não tem o que
  // mostrar. O que resolve é salvar os Parâmetros uma primeira vez.
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  const acaoId = await semearAcao(LEAD_A)

  const resultado = await rodar()

  assert.equal(resultado.ok, false)
  assert.equal(resultado.motivo, 'config_ausente')
  assert.equal(resultado.reservadas, 0)
  assert.equal(resultado.limite, null)
  assert.equal(resultado.janela, null)
  assert.equal(enviados.length, 0)
  assert.equal((await acao(acaoId)).ativo, true)
})

test('campanha desligada: zero COM motivo, sem reservar e sem chamar o disparador', async () => {
  await semearConfig({ ativo: false })
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  const acaoId = await semearAcao(LEAD_A)

  const resultado = await rodar()

  assert.equal(resultado.ok, false)
  assert.equal(resultado.motivo, 'campanha_inativa')
  assert.equal(resultado.enviados, 0)
  assert.equal(resultado.reservadas, 0)
  assert.equal(enviados.length, 0)
  assert.equal((await acao(acaoId)).ativo, true)
  assert.deepEqual(await recibos(), [])
  // A janela sai preenchida mesmo quando a recusa é outra: o operador que vê "campanha
  // inativa" ainda quer saber que horas a régua achou que eram.
  assert.equal(resultado.janela?.horaLocal, '12:00')
})

test('fora do horário: o motivo é o relógio, e nada é reservado', async () => {
  await semearConfig({ horario_inicio: '13:00', horario_fim: '18:00' })
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  const acaoId = await semearAcao(LEAD_A)

  const resultado = await rodar()

  assert.equal(resultado.motivo, 'fora_do_horario')
  assert.equal(enviados.length, 0)
  assert.equal((await acao(acaoId)).ativo, true)
})

test('todo motivo tem frase, e nenhuma frase é a de outro motivo', () => {
  /* A lista é escrita à mão de propósito: um `Object.keys` do próprio mapa provaria que
   * o mapa é igual a si mesmo. Motivo novo sem entrada aqui reprova a suíte, e sem
   * entrada no mapa reprova o compilador — as duas portas, porque a que falta é sempre a
   * que importa. */
  const motivos: MotivoDaRodada[] = [
    'ok', 'campanha_inativa', 'remetente_nao_configurado', 'fase_final_nao_configurada',
    'dias_ativos_invalido', 'dia_inativo', 'horario_invalido', 'horario_invertido',
    'fora_do_horario', 'limite_diario_nao_configurado', 'limite_diario_invalido',
    'limite_diario_zero', 'limite_diario_atingido', 'contagem_nao_fornecida',
    'contagem_indisponivel', 'contagem_invalida', 'nada_devido', 'todos_descartados',
    'config_ausente', 'registro_indisponivel', 'envio_falhou',
  ]

  const frases = new Set<string>()
  for (const motivo of motivos) {
    const frase = fraseDoMotivo(motivo)
    assert.ok(frase && frase.trim() !== '', `${motivo} ficou sem frase`)
    // Frase repetida é a tela dizendo a mesma coisa para dois estados diferentes — o
    // zero genérico voltando com outra roupa.
    assert.ok(!frases.has(frase), `a frase de ${motivo} está repetida`)
    frases.add(frase)
  }
})

test('a rodada que não enviou carrega a frase do motivo, e não um "HTTP undefined"', async () => {
  // A tela de Credenciais escreve `Falha: {error ?? 'HTTP ' + status}`. Uma recusa
  // honesta não tem status HTTP nenhum, então sem frase ela mostraria "HTTP undefined".
  await semearConfig({ ativo: false })
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  await semearAcao(LEAD_A)

  const resultado = await rodar()

  assert.equal(resultado.statusDoEnvio, undefined)
  assert.equal(fraseDoMotivo(resultado.motivo), 'a campanha está desligada nos Parâmetros')
})

test('fila vazia é nada_devido, e não um zero sem explicação', async () => {
  await semearConfig()
  await semearTemplate('Template 1', 'boas_vindas', 'Oi {{1}}, tudo bem?')
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000')
  // Agendada para o futuro: existe, e não está devida.
  await semearAcao(LEAD_A, { vencidaHa: '-2 hours' })

  const resultado = await rodar()

  assert.equal(resultado.ok, false)
  assert.equal(resultado.motivo, 'nada_devido')
  assert.equal(resultado.reservadas, 0)
  assert.equal(resultado.devidosSemFase, 0)
  assert.equal(enviados.length, 0)
})
