// Testes da régua de disparo (lib/sdr/regua) contra Postgres DE VERDADE.
//
// Duas coisas aqui não sobrevivem a um mock, e são exatamente as duas que podem fazer
// alguém receber a mesma mensagem duas vezes:
//
//   1. a RESERVA numa instrução só (`FOR UPDATE SKIP LOCKED` + `UPDATE ... RETURNING`).
//      Perguntar "duas chamadas simultâneas podem pegar a mesma linha?" só tem uma
//      resposta autoritativa, e é a do Postgres;
//   2. o `LEFT JOIN LATERAL` que acha o template da fase, com `fase <> fase_final` em
//      lógica de três valores.
//
// Por isso o PGlite (o Postgres compilado para WASM) entra pela fábrica de pools de
// lib/sdr/pg: o SQL de produção roda inteiro, sem o teste reescrever nada.
//
// É UM BANCO SÓ, e isso MUDOU: o do CLIENTE (`leads`, `lead_actions`,
// `meta_templates_whatsapp`), que sobe cru (`comSchema: false`) porque essas tabelas não
// são do schema da app — o DDL mínimo delas mora aqui, copiado do que o n8n escrevia.
//
// Havia um segundo banco aqui, o DA APP, com as migrações reais, porque a régua contava
// `blast_recipients` para descontar o limite do dia. Essa contagem SAIU do módulo: ela é
// porta obrigatória agora (`contarEnviadosHoje`), e quem a preenche em produção é
// `contarConsumidasHoje` de lib/sdr/reservas — que tem o teste dela, contra o banco da
// app de verdade, em lib/sdr/reservas.test.ts. Testar aqui de novo seria testar o banco
// dos outros.
//
// A porta entra aqui como um livro-caixa de mentira: um contador por BALDE DO DIA (ver
// `consumidas`, lá embaixo). A FORMA é o que importa nele — um fake que devolvesse um
// número fixo faria o teste "mensagem de outro dia não consome a cota de hoje" passar
// sem testar balde nenhum.
//
// SOBRE A CONCORRÊNCIA QUE O PGLITE CONSEGUE E A QUE ELE NÃO CONSEGUE
// O PGlite tem UM backend: duas consultas nunca executam ao mesmo tempo. Então o
// `SKIP LOCKED` propriamente dito não é exercitado aqui — o que É exercitado, e é o
// que garante a correção, é que selecionar e reservar são a MESMA instrução. O teste
// da corrida segura as duas chamadas num portão até que ambas tenham entregado o seu
// comando ao banco; com uma instrução cada, a segunda encontra `ativo = false` e volta
// vazia. Uma implementação em duas instruções (SELECT, depois UPDATE) intercala nesse
// mesmo portão e reserva a linha duas vezes — ou seja, o teste reprova o desenho
// errado, que é o que se pede dele.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import type { QueryResult, QueryResultRow } from 'pg'
import { bancoDeTeste } from '@/test-support/pglite'
import { closeAllSdrPools, setSdrPoolFactory, type SdrPool } from '@/lib/sdr/pg'
import {
  CONTAGEM_INCOMPLETA,
  baldeDoDia,
  contagemUtilizavel,
  devolverReservas,
  diasAtivosDe,
  horaLocalSp,
  janelaDeEnvio,
  lerLimiteDiario,
  limiteUtilizavel,
  minutosDoRelogio,
  selecionarDevidos,
  vagasDoDia,
  type ConfigDaRegua,
  type PedidoDaRegua,
} from '@/lib/sdr/regua'

/* String de conexão EXCLUSIVA deste arquivo. Os pools de lib/sdr/pg ficam num mapa
 * de módulo indexado pelo hash da string: dois arquivos de teste com a mesma string
 * compartilhariam o pool, e portanto o banco. */
const CONN = 'postgresql://postgres.reguadisparo:S3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'

const TENANT = 'tenant-regua'

const LEAD_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const LEAD_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const LEAD_C = 'cccccccc-3333-4333-8333-333333333333'
const LEAD_SUMIDO = 'dddddddd-4444-4444-8444-444444444444'

/* Quarta-feira, 12:00 em São Paulo (15:00 em UTC). Dentro da janela padrão dos
 * testes (seg–sex, 09:00–18:00) pelas duas contas — é o instante "sem graça", contra
 * o qual as bordas de fuso lá embaixo são comparadas. */
const QUARTA_MEIO_DIA = new Date('2026-09-23T15:00:00Z')

/** A configuração que a tela de Parâmetros grava, com tudo preenchido. */
const CONFIG: ConfigDaRegua = {
  ativo: true,
  remetente: 'Equipe Multi10',
  limite_diario: 10,
  fase_final: 'Template 5',
  horario_inicio: '09:00',
  horario_fim: '18:00',
  dias_ativos: '1,2,3,4,5',
}

/** A config padrão com alguns campos trocados. */
function com(mudancas: Partial<ConfigDaRegua>): ConfigDaRegua {
  return { ...CONFIG, ...mudancas }
}

// As tabelas da base do CLIENTE, como o fluxo do n8n as usa.
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
`

let cliente: PGlite
let fecharCliente: () => Promise<void>

/** Todo SQL que chegou à base do cliente — é como se prova que uma chamada NÃO
 *  consultou, e que a reserva é uma instrução só. */
let consultas: string[] = []

/**
 * O livro-caixa das reservas, de mentira: quanto da cota já foi comprometido, POR BALDE
 * DO DIA. É o formato de `contarConsumidasHoje` de lib/sdr/reservas — a função que, em
 * produção, entra na porta `contarEnviadosHoje` da régua.
 *
 * Ser indexado pelo balde, e não um número solto, é o ponto: é isso que deixa o teste do
 * "registrado em OUTRO dia" continuar testando alguma coisa depois que a consulta ao
 * banco da app saiu do módulo.
 */
const consumidas = new Map<string, number>()

/** A porta de contagem, como todo teste daqui a passa. Lê o mesmo `baldeDoDia` que a
 *  régua usa — de propósito: uma fórmula de balde remontada aqui provaria que os dois
 *  concordam com uma cópia, e não entre si. */
async function contarPeloLivroCaixa(tenantId: string, agora: Date): Promise<number> {
  return consumidas.get(baldeDoDia(tenantId, agora)) ?? 0
}

/** Quando ligado, toda consulta à base do cliente espera aqui. Ver SOBRE A
 *  CONCORRÊNCIA no cabeçalho. */
let portao: (() => Promise<void>) | null = null

/**
 * Portão que só abre depois de `n` consultas terem sido ENTREGUES ao banco. O
 * temporizador é rede de segurança: se a implementação mandar menos consultas do que o
 * teste espera, ele falha numa asserção em vez de pendurar a suíte inteira.
 */
function portaoPara(n: number): () => Promise<void> {
  let chegaram = 0
  let abrir!: () => void
  const aberto = new Promise<void>(resolver => { abrir = resolver })
  setTimeout(() => abrir(), 2_000).unref()
  return async () => {
    if (++chegaram >= n) abrir()
    await aberto
  }
}

before(async () => {
  const cru = await bancoDeTeste({ comSchema: false })
  cliente = cru.pg
  fecharCliente = cru.fechar
  await cliente.exec(DDL_CLIENTE)

  // A fábrica de pools de produção trocada por uma que fala com o PGlite do cliente.
  // O resto do caminho (buildSdrPoolConfig, cache, withSdrDb, tradução de erro) é real.
  setSdrPoolFactory(() => {
    const pool: SdrPool = {
      async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
        consultas.push(text)
        if (portao) await portao()
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
  await fecharCliente()
})

beforeEach(async () => {
  await cliente.exec('TRUNCATE lead_actions; TRUNCATE leads; TRUNCATE meta_templates_whatsapp;')
  consumidas.clear()
  consultas = []
  portao = null
})

// ─── Semeadura ────────────────────────────────────────────────────────────────

async function semearLead(
  id: string,
  name: string | null,
  phone: string | null,
  phoneAdjusted: string | null = null,
): Promise<void> {
  await cliente.query(
    'INSERT INTO leads (id, name, phone, phone_adjusted) VALUES ($1, $2, $3, $4)',
    [id, name, phone, phoneAdjusted],
  )
}

/** Uma `lead_actions` ativa e já vencida. Devolve o id, que é o recibo da reserva.
 *  `fase: null` é a linha legada que a lógica de três valores deixa de fora. */
async function semearAcao(
  leadId: string,
  fase: string | null = 'Template 1',
  opts: { ativo?: boolean | null; vencidaHa?: string } = {},
): Promise<string> {
  const rs = await cliente.query<{ id: string }>(
    `INSERT INTO lead_actions (lead_id, fase, id_fase, ativo, data_proxima_msg_outbound)
     VALUES ($1, $2, $3, $4, $5::timestamptz - ($6)::interval)
     RETURNING id`,
    [
      leadId, fase, fase === null ? null : Number(fase.match(/(\d+)/)?.[1] ?? 1),
      opts.ativo === undefined ? true : opts.ativo,
      QUARTA_MEIO_DIA.toISOString(), opts.vencidaHa ?? '1 hour',
    ],
  )
  return rs.rows[0].id
}

async function semearTemplate(
  fase: string,
  nome: string | null = 'tpl_boas_vindas',
  corpo = 'Oi {{1}}, tudo bem?',
  rank: number | null = 1,
): Promise<void> {
  await cliente.query(
    'INSERT INTO meta_templates_whatsapp (nome_template, mensagem_template, fase_envio, rank_disparo) VALUES ($1, $2, $3, $4)',
    [nome, corpo, fase, rank],
  )
}

async function acao(id: string): Promise<{ ativo: boolean | null; fase: string | null }> {
  const rs = await cliente.query<{ ativo: boolean | null; fase: string | null }>(
    'SELECT ativo, fase FROM lead_actions WHERE id = $1', [id],
  )
  return rs.rows[0]
}

/** Põe `quantas` vagas já comprometidas no balde daquele instante — reserva em voo ou
 *  mensagem já enviada, que para a cota é a mesma coisa (ver STATUS_QUE_CONSOMEM em
 *  lib/sdr/reservas). */
function semearConsumidas(quantas: number, agora: Date): void {
  const balde = baldeDoDia(TENANT, agora)
  consumidas.set(balde, (consumidas.get(balde) ?? 0) + quantas)
}

/** O caminho feliz inteiro: um lead com nome e telefone, ação vencida, template da fase. */
async function cenarioCompleto(): Promise<string> {
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000', '5511999990000')
  await semearTemplate('Template 1')
  return semearAcao(LEAD_A, 'Template 1')
}

// ─── Ajudantes puros ──────────────────────────────────────────────────────────

test('minutosDoRelogio aceita HH:MM e HH:MM:SS, recusa hora que não existe', () => {
  assert.equal(minutosDoRelogio('09:00'), 540)
  assert.equal(minutosDoRelogio('00:00'), 0)
  assert.equal(minutosDoRelogio('23:59'), 1439)
  // Base do cliente com a coluna como `time` devolve com segundos.
  assert.equal(minutosDoRelogio('18:30:00'), 1110)
  assert.equal(minutosDoRelogio(' 9:05 '), 545)

  for (const ruim of ['24:00', '10:71', '9h', '', '  ', 'meio-dia', null, 540]) {
    assert.equal(minutosDoRelogio(ruim), null, `${String(ruim)} devia ser recusado`)
  }
})

test('diasAtivosDe trata 0 e 7 como o MESMO domingo', () => {
  /* A tela de Parâmetros grava domingo como 0 (convenção do JavaScript) e a régua
   * compara em ISO, onde domingo é 7. Aceitar só um dos dois faria a campanha
   * ignorar o domingo de quem marcou o botão — ou disparar no domingo de quem não
   * marcou. Segunda a sábado batem nas duas convenções. */
  assert.deepEqual(diasAtivosDe('1,2,3,4,5'), [1, 2, 3, 4, 5])
  assert.deepEqual(diasAtivosDe('0'), [7])
  assert.deepEqual(diasAtivosDe('7'), [7])
  assert.deepEqual(diasAtivosDe('1,2,3,4,5,6,0'), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(diasAtivosDe(' 1 , 3 '), [1, 3])
})

test('diasAtivosDe invalida a lista INTEIRA quando um pedaço não presta', () => {
  // Descartar o pedaço ruim em silêncio seria uma campanha que para de disparar num
  // dia sem ninguém saber por quê.
  for (const ruim of ['2,x,5', '1;2', '8', '-1', '', '   ', null, 5]) {
    assert.equal(diasAtivosDe(ruim), null, `${String(ruim)} devia invalidar a lista`)
  }
})

test('limiteUtilizavel aceita o número EM TEXTO, e recusa o que viraria zero por acidente', () => {
  /* O `pg` devolve `numeric`, `bigint` e `text` como STRING, e o schema de
   * `campaign_config` não é nosso: a coluna que num cliente é `integer` pode ser
   * `numeric` no outro. Um '100' recusado por não ser `number` é campanha parada com a
   * tela de Parâmetros mostrando 100 — o silêncio que este módulo existe para acabar.
   * É a mesma tolerância que `minutosDoRelogio` já dá ao relógio guardado como `time`. */
  assert.equal(limiteUtilizavel(10), 10)
  assert.equal(limiteUtilizavel(0), 0)
  assert.equal(limiteUtilizavel('100'), 100)
  assert.equal(limiteUtilizavel(' 7 '), 7)
  assert.equal(limiteUtilizavel('0'), 0)
  assert.equal(limiteUtilizavel('2147483647'), 2_147_483_647)

  /* O que continua recusado é exatamente o que viraria zero (ou um) por acidente —
   * `Number('')` e `Number([])` são 0, `Number(true)` é 1 — mais o fracionário, o
   * negativo e o que não cabe numa coluna `integer`. */
  for (const ruim of [
    null, undefined, '', '   ', '10 leads', '1e3', '0x10',
    3.7, '3.7', -1, '-1', NaN, Infinity, 2_147_483_648, '2147483648',
    true, false, [], [10], {},
  ]) {
    assert.equal(limiteUtilizavel(ruim), null, `${JSON.stringify(ruim) ?? String(ruim)} devia ser recusado`)
  }
})

test('lerLimiteDiario separa "falta configurar" de "está configurado errado"', () => {
  /* Os dois mandam o operador a lugares diferentes: um pede que ele PREENCHA, o outro
   * que ele ARRUME o que já está lá. Responder `-1` como "não configurado" manda quem
   * for consertar procurar um campo vazio que está preenchido. */
  assert.deepEqual(lerLimiteDiario(10), { estado: 'ok', limite: 10 })
  assert.deepEqual(lerLimiteDiario('10'), { estado: 'ok', limite: 10 })
  assert.deepEqual(lerLimiteDiario(0), { estado: 'ok', limite: 0 }, 'zero é um limite válido')

  for (const vazio of [null, undefined, '', '   ']) {
    assert.deepEqual(lerLimiteDiario(vazio), { estado: 'ausente' }, `${String(vazio)} é ausência`)
  }
  for (const errado of [-1, '-1', 3.7, 'dez', true, 2_147_483_648]) {
    assert.deepEqual(lerLimiteDiario(errado), { estado: 'invalido' }, `${String(errado)} é inválido`)
  }
})

test('contagemUtilizavel fecha as DUAS direções em que a contagem estraga o limite', () => {
  /* `NaN` atravessa a subtração e chega ao `LIMIT $3::int`, que o Postgres recusa — o
   * operador leria "não foi possível falar com a base do SDR" por causa de uma conta
   * nossa. `null` num `?? 0` devolveria a cota inteira: o limite diário DESLIGADO em
   * silêncio. As duas param aqui. */
  assert.equal(contagemUtilizavel(0), 0)
  assert.equal(contagemUtilizavel(8), 8)
  // Um `SELECT count(*)` pelo `pg` chega como string (é `bigint`).
  assert.equal(contagemUtilizavel('8'), 8)

  for (const ruim of [NaN, Infinity, null, undefined, -1, 1.5, '', '  ', 'oito', true, {}]) {
    assert.equal(contagemUtilizavel(ruim), null, `${String(ruim)} devia ser recusado`)
  }
})

test('vagasDoDia subtrai o que já saiu e nunca devolve negativo', () => {
  assert.equal(vagasDoDia(10, 0), 10)
  assert.equal(vagasDoDia(10, 4), 6)
  assert.equal(vagasDoDia(10, 10), 0)
  assert.equal(vagasDoDia(10, 25), 0)
  assert.equal(vagasDoDia(0, 0), 0)
  assert.equal(vagasDoDia(null, 0), null)

  // Texto dos dois lados, porque os dois podem vir do driver.
  assert.equal(vagasDoDia('10', '4'), 6)

  /* E nenhuma contagem imprestável vira número: `NaN` viajaria até o banco do cliente,
   * `null` devolveria o limite inteiro. Aqui as duas viram `null`, que é o que o
   * chamador consegue transformar em motivo. */
  for (const ruim of [NaN, null, undefined, -3, 1.5, 'oito']) {
    assert.equal(vagasDoDia(10, ruim), null, `${String(ruim)} devia invalidar a conta`)
  }
})

// ─── Fuso de São Paulo ────────────────────────────────────────────────────────

test('horaLocalSp lê o relógio de Brasília, não o do servidor em UTC', () => {
  // 15:00 UTC é 12:00 em São Paulo — três horas de diferença que decidem se a
  // campanha dispara dentro ou fora do horário comercial.
  const h = horaLocalSp(QUARTA_MEIO_DIA)
  assert.equal(h.hhmm, '12:00')
  assert.equal(h.minutos, 720)
  assert.equal(h.diaIso, 3) // quarta
  assert.equal(h.aaaammdd, '20260923')
})

test('meia-noite local sai como 00:00 e vale ZERO minuto', () => {
  /* 03:00 UTC = 00:00 em São Paulo. Este teste prende o RESULTADO — meia-noite lida
   * como 00:00 e como zero minuto, que é o que quebraria se alguém trocasse o
   * formatador por `getHours()` ou por uma conta de fuso na mão.
   *
   * O QUE ELE NÃO PRENDE, e é melhor dizer do que deixar parecendo que prende: a
   * escolha de `hourCycle: 'h23'` em vez de `hour12: false`. No ICU deste runtime
   * (78.2) as duas grafias são indistinguíveis — imprimem "00:00" e `resolvedOptions()`
   * devolve `hourCycle: 'h23'` nas duas. A escolha continua no código, comentada, como
   * precaução para ICU antigo; nenhum teste que rode aqui consegue defendê-la, e um
   * teste que não pode falhar parece proteção sem ser. */
  const h = horaLocalSp(new Date('2026-09-24T03:00:00Z'))
  assert.equal(h.hhmm, '00:00')
  assert.equal(h.minutos, 0)
  assert.equal(h.aaaammdd, '20260924')
})

test('importar o módulo NÃO constrói o relógio — ele é do primeiro uso', async () => {
  /* `new Intl.DateTimeFormat` com fuso nomeado lança `RangeError` num Node sem ICU
   * completo. Se o formatador fosse construído na avaliação do módulo, IMPORTAR
   * lib/sdr/regua derrubaria quem o importasse — inclusive quem só quisesse
   * `limiteUtilizavel`. Em processo nenhum dá para provar isso depois do import: a
   * prova é um Node novo, com `Intl.DateTimeFormat` quebrado ANTES do import.
   *
   * De quebra, este é o teste de que nada neste módulo lê ambiente nem abre conexão ao
   * ser importado: qualquer coisa assim apareceria como falha do filho. */
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { fileURLToPath } = await import('node:url')

  const modulo = new URL('./regua.ts', import.meta.url).href
  const raiz = fileURLToPath(new URL('../../', import.meta.url))

  const roteiro = `
    const real = Intl.DateTimeFormat
    Intl.DateTimeFormat = function () { throw new RangeError('Node sem ICU completo') }
    const ns = await import(${JSON.stringify(modulo)})
    const regua = ns.default ?? ns
    if (typeof regua.horaLocalSp !== 'function') throw new Error('o módulo nem carregou')
    // Com o relógio quebrado, quem falha é a CHAMADA — e falha toda vez, sem guardar
    // um formatador estragado no lugar do bom.
    try { regua.horaLocalSp(new Date()); throw new Error('devia ter falhado') }
    catch (e) { if (!(e instanceof RangeError)) throw e }
    Intl.DateTimeFormat = real
    process.stdout.write(regua.horaLocalSp(new Date('2026-09-23T15:00:00Z')).hhmm)
  `

  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', roteiro],
    { cwd: raiz },
  )

  assert.equal(stdout.trim(), '12:00', 'importou sem relógio e leu a hora depois')
})

test('o dia da semana vem da data LOCAL: domingo 22h em SP é segunda em UTC', () => {
  const h = horaLocalSp(new Date('2026-09-28T01:00:00Z'))
  assert.equal(h.diaIso, 7, 'domingo em São Paulo')
  assert.equal(h.aaaammdd, '20260927', 'e ainda é dia 27 por aqui')
})

test('o balde do dia é o MESMO que o ack de dispatch monta', () => {
  /* Se este id divergir do de app/api/sdr/dispatch/ack, não dá erro nenhum: dá uma
   * contagem eternamente zero, ou seja, limite diário nenhum. Por isso a fórmula do
   * ack é recalculada aqui, à parte, em vez de a função ser comparada consigo mesma.
   *
   * Este teste NÃO depende de banco nenhum, e é por isso que ele sobrevive à saída da
   * consulta ao banco da app. Ele ficou mais importante, não menos: `baldeDoDia` é agora
   * o ponto em que TRÊS coisas têm de concordar — as linhas de `blast_recipients` que o
   * ack escreve, as de `dispatch_claims` que lib/sdr/reservas escreve (chamando esta
   * função, justamente para não ter cópia da fórmula) e a cota que a régua desconta. */
  const comoNoAck = (agora: Date) =>
    `${TENANT}:drip:${agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).replace(/-/g, '')}`

  for (const iso of ['2026-09-23T15:00:00Z', '2026-09-28T01:00:00Z', '2026-01-01T02:30:00Z']) {
    const agora = new Date(iso)
    assert.equal(baldeDoDia(TENANT, agora), comoNoAck(agora), iso)
  }
})

// ─── A janela, sem banco ──────────────────────────────────────────────────────

test('janela inclusiva nas duas pontas: 09:00 e 18:00 em ponto disparam', () => {
  const as = (hhmmUtc: string) => janelaDeEnvio(CONFIG, new Date(`2026-09-23T${hhmmUtc}:00Z`))
  assert.equal(as('12:00').aberta, true, '09:00 local — a ponta de baixo')
  assert.equal(as('21:00').aberta, true, '18:00 local — a ponta de cima')
  assert.equal(as('11:59').aberta, false, '08:59 local')
  assert.equal(as('21:01').aberta, false, '18:01 local')
})

test('config sem horário nenhum não restringe, e a bandeira diz isso', () => {
  // Base antiga nunca teve esses valores: recusar pararia campanha que hoje funciona.
  const r = janelaDeEnvio(com({ horario_inicio: null, horario_fim: null }), new Date('2026-09-24T06:00:00Z'))
  assert.equal(r.aberta, true, '03:00 em São Paulo, e mesmo assim passa')
  assert.equal(r.janela.horarioAplicado, false)
})

test('metade da janela preenchida é recusa, não meia liberdade', () => {
  const r = janelaDeEnvio(com({ horario_fim: null }), QUARTA_MEIO_DIA)
  assert.equal(r.aberta, false)
  assert.equal(r.aberta === false && r.motivo, 'horario_invalido')
})

test('início depois do fim é recusado em vez de virar janela que vira a noite', () => {
  const r = janelaDeEnvio(com({ horario_inicio: '22:00', horario_fim: '06:00' }), QUARTA_MEIO_DIA)
  assert.equal(r.aberta, false)
  assert.equal(r.aberta === false && r.motivo, 'horario_invertido')
})

test('quando o dia E a hora recusam, o motivo é o do DIA', () => {
  /* Mensagem no domingo incomoda mais do que mensagem às 08h55: o motivo que chega ao
   * operador tem de ser o mais grave dos dois. Quem decide isso é a ORDEM das duas
   * guardas, e sem este teste inverter a ordem não quebra nada — as duas recusam. */
  // Domingo, 08:00 em São Paulo: fora de seg–sex E antes das 09:00.
  const domingoCedo = janelaDeEnvio(CONFIG, new Date('2026-09-27T11:00:00Z'))
  assert.equal(domingoCedo.aberta, false)
  assert.equal(domingoCedo.aberta === false && domingoCedo.motivo, 'dia_inativo')

  // E o mesmo entre os dois "cadastro ilegível": arrumar o dia vem primeiro.
  const cadastroRuim = janelaDeEnvio(
    com({ dias_ativos: '1,seg,5', horario_inicio: '25:00' }),
    QUARTA_MEIO_DIA,
  )
  assert.equal(cadastroRuim.aberta === false && cadastroRuim.motivo, 'dias_ativos_invalido')
})

// ─── As recusas, com o banco do cliente intacto ───────────────────────────────

/* A porta de contagem vai em TODA chamada porque ela é obrigatória — não há default para
 * cair, e o módulo não tem mais como contar sozinho. Ela mora aqui, num ajudante só, para
 * que passá-la não vire ruído repetido em trinta testes; o que cada teste escolhe é o
 * CONTEÚDO do livro-caixa (`semearConsumidas`), não se a porta existe. Os testes que
 * falam da porta em si a passam na mão, logo abaixo. */
async function motivoDe(config: ConfigDaRegua, agora = QUARTA_MEIO_DIA) {
  return selecionarDevidos(CONN, {
    tenantId: TENANT, config, agora, contarEnviadosHoje: contarPeloLivroCaixa,
  })
}

test('campanha desligada devolve lote vazio com motivo — e NÃO toca no banco', async () => {
  await cenarioCompleto()

  const lote = await motivoDe(com({ ativo: false }))

  assert.equal(lote.motivo, 'campanha_inativa')
  assert.deepEqual(lote.enviar, [])
  assert.equal(lote.reservadas, 0)
  // Nenhuma linha pode ter sido reservada por uma campanha que está desligada.
  assert.deepEqual(consultas, [])
  // A janela vai no resultado mesmo quando a recusa é outra: o operador que lê
  // "campanha inativa" ainda quer saber que horas a régua achou que eram.
  assert.equal(lote.janela.horaLocal, '12:00')
})

test('ativo NULL conta como desligado — interruptor só liga com true', async () => {
  await cenarioCompleto()
  assert.equal((await motivoDe(com({ ativo: null }))).motivo, 'campanha_inativa')
})

test('sem remetente não sai nada, e nada é reservado', async () => {
  const acaoId = await cenarioCompleto()

  const lote = await motivoDe(com({ remetente: '  ' }))

  assert.equal(lote.motivo, 'remetente_nao_configurado')
  assert.deepEqual(consultas, [])
  assert.equal((await acao(acaoId)).ativo, true)
})

test('sem fase_final o motivo é próprio — e não um zero sem explicação', async () => {
  /* `fase <> NULL` é NULL para toda linha: a consulta voltaria vazia e pareceria
   * "não tem ninguém na fila". A recusa nomeada é a diferença entre o operador
   * arrumar a config e o operador procurar defeito nos leads. */
  await cenarioCompleto()

  const lote = await motivoDe(com({ fase_final: null }))

  assert.equal(lote.motivo, 'fase_final_nao_configurada')
  assert.deepEqual(consultas, [])
})

test('fora do horário de trabalho: nada sai e nada é reservado', async () => {
  const acaoId = await cenarioCompleto()

  // 11:00 UTC = 08:00 em São Paulo, antes das 09:00 da config.
  const lote = await motivoDe(CONFIG, new Date('2026-09-23T11:00:00Z'))

  assert.equal(lote.motivo, 'fora_do_horario')
  assert.equal(lote.janela.horaLocal, '08:00')
  assert.deepEqual(consultas, [])
  assert.equal((await acao(acaoId)).ativo, true, 'a linha continua disponível')
})

test('dia da semana fora de dias_ativos não dispara', async () => {
  await cenarioCompleto()

  // Domingo, 09:00 em São Paulo — dentro da faixa de horas, fora dos dias.
  const lote = await motivoDe(CONFIG, new Date('2026-09-27T12:00:00Z'))

  assert.equal(lote.motivo, 'dia_inativo')
  assert.equal(lote.janela.diaIso, 7)
  assert.deepEqual(consultas, [])
})

test('dias_ativos ilegível é recusa nomeada, não "domingo"', async () => {
  await cenarioCompleto()
  assert.equal((await motivoDe(com({ dias_ativos: '1,seg,5' }))).motivo, 'dias_ativos_invalido')
})

// ─── Fuso: as duas bordas que o servidor em UTC erraria ───────────────────────

test('17:00 em São Paulo está DENTRO da janela, embora sejam 20:00 em UTC', async () => {
  const acaoId = await cenarioCompleto()

  // Lido em UTC, 20:00 estaria muito além das 18:00 e o lote sairia vazio.
  const lote = await motivoDe(CONFIG, new Date('2026-09-23T20:00:00Z'))

  assert.equal(lote.motivo, 'ok')
  assert.equal(lote.janela.horaLocal, '17:00')
  assert.equal(lote.enviar.length, 1)
  assert.equal((await acao(acaoId)).ativo, false)
})

test('06:00 em São Paulo está FORA da janela, embora 09:00 em UTC estivesse dentro', async () => {
  const acaoId = await cenarioCompleto()

  const lote = await motivoDe(CONFIG, new Date('2026-09-23T09:00:00Z'))

  assert.equal(lote.motivo, 'fora_do_horario')
  assert.equal(lote.janela.horaLocal, '06:00')
  assert.equal((await acao(acaoId)).ativo, true, 'ninguém acordou às 6 da manhã')
})

test('domingo 22h em SP é dia inativo, mesmo já sendo SEGUNDA em UTC', async () => {
  await cenarioCompleto()

  const lote = await motivoDe(
    com({ horario_inicio: null, horario_fim: null }),
    new Date('2026-09-28T01:00:00Z'),
  )

  assert.equal(lote.motivo, 'dia_inativo', 'em UTC seria segunda, que É dia ativo')
  assert.equal(lote.janela.diaIso, 7)
})

// ─── Limite diário ────────────────────────────────────────────────────────────

test('sem nada enviado hoje, a cota inteira está disponível', async () => {
  await cenarioCompleto()

  const lote = await motivoDe(com({ limite_diario: 10 }))

  assert.equal(lote.motivo, 'ok')
  assert.deepEqual(
    { limiteDiario: lote.limite.limiteDiario, enviadosHoje: lote.limite.enviadosHoje, disponivel: lote.limite.disponivel },
    { limiteDiario: 10, enviadosHoje: 0, disponivel: 10 },
  )
  assert.equal(lote.limite.balde, baldeDoDia(TENANT, QUARTA_MEIO_DIA))
})

test('o que já foi comprometido HOJE é descontado da cota — não do lote da execução', async () => {
  /* O defeito que este teste prende: no n8n o `limite_diario` vale POR EXECUÇÃO, e o
   * cron roda três vezes por dia — limite 10 manda 30. Aqui o limite é do DIA. */
  semearConsumidas(8, QUARTA_MEIO_DIA)
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno', '+5511988880000')
  await semearLead(LEAD_C, 'Carla', '+5511977770000')
  await semearTemplate('Template 1')
  await semearAcao(LEAD_A, 'Template 1', { vencidaHa: '3 hours' })
  await semearAcao(LEAD_B, 'Template 1', { vencidaHa: '2 hours' })
  await semearAcao(LEAD_C, 'Template 1', { vencidaHa: '1 hour' })

  const lote = await motivoDe(com({ limite_diario: 10 }))

  assert.equal(lote.limite.enviadosHoje, 8, 'o que a porta achou no balde de hoje')
  assert.equal(lote.limite.disponivel, 2)
  assert.equal(lote.enviar.length, 2, 'só as duas vagas que sobraram')
  // Quem esperava há mais tempo passa na frente.
  assert.deepEqual(lote.enviar.map(d => d.leadId), [LEAD_A, LEAD_B])
  // E a terceira linha continua ativa: não foi reservada à toa.
  assert.equal(lote.reservadas, 2)
})

test('vaga comprometida em OUTRO dia não consome a cota de hoje', async () => {
  /* O recorte é o balde, e o balde é do fuso de São Paulo. Este teste continua valendo
   * depois de a consulta ao banco da app sair do módulo porque o livro-caixa de mentira
   * é indexado POR BALDE, como o de verdade. */
  semearConsumidas(5, new Date('2026-09-22T15:00:00Z'))
  await cenarioCompleto()

  const lote = await motivoDe(com({ limite_diario: 10 }))

  assert.equal(lote.limite.enviadosHoje, 0)
  assert.equal(lote.limite.disponivel, 10)
})

test('cota esgotada: motivo próprio, e NENHUMA linha reservada', async () => {
  semearConsumidas(10, QUARTA_MEIO_DIA)
  const acaoId = await cenarioCompleto()

  const lote = await motivoDe(com({ limite_diario: 10 }))

  assert.equal(lote.motivo, 'limite_diario_atingido')
  assert.equal(lote.limite.disponivel, 0)
  assert.deepEqual(consultas, [], 'a base do cliente não chega a ser consultada')
  assert.equal((await acao(acaoId)).ativo, true)
})

test('cada jeito de o limite não servir tem o seu motivo — e nenhum deles mente', async () => {
  await cenarioCompleto()

  // Não informado: falta CONFIGURAR.
  for (const vazio of [null, undefined, '  ']) {
    assert.equal(
      (await motivoDe(com({ limite_diario: vazio }))).motivo,
      'limite_diario_nao_configurado', `${String(vazio)} é ausência`,
    )
  }

  /* Informado e imprestável: NÃO é "não configurado". Dizer que falta configurar manda
   * o operador procurar um campo vazio que está preenchido com -1. */
  for (const errado of [-1, 3.7, 'dez', 2_147_483_648]) {
    assert.equal(
      (await motivoDe(com({ limite_diario: errado }))).motivo,
      'limite_diario_invalido', `${String(errado)} está configurado errado`,
    )
  }

  /* Zero não é "atingido": ninguém atingiu nada, foi configurado para não disparar — e
   * lib/sdr/config-write aceita 0 como válido, então isto chega pelo produto, não por
   * base corrompida. */
  const zero = await motivoDe(com({ limite_diario: 0 }))
  assert.equal(zero.motivo, 'limite_diario_zero')
  assert.equal(zero.limite.disponivel, 0, 'a vaga disponível é fato: zero')
  assert.equal(zero.limite.enviadosHoje, null, 'e nem foi preciso contar para saber')

  // Nenhum deles chega a tocar na base do cliente.
  assert.deepEqual(consultas, [])
})

test('limite_diario que chega como TEXTO dispara igual — a coluna pode não ser integer', async () => {
  /* O mais grave dos defeitos silenciosos: com `typeof valor === 'number'`, um '100'
   * vindo de uma coluna `numeric`/`text` (o `pg` devolve as duas como string) virava
   * `limite_diario_nao_configurado` — zero mensagem, com a tela de Parâmetros mostrando
   * 100 e ninguém sabendo de nada. */
  await cenarioCompleto()

  const lote = await motivoDe(com({ limite_diario: '100' }))

  assert.equal(lote.motivo, 'ok')
  assert.equal(lote.limite.limiteDiario, 100)
  assert.equal(lote.limite.disponivel, 100)
  assert.equal(lote.enviar.length, 1)
})

test('contagem que FALHA não sobe como erro cru nem como erro da base do cliente', async () => {
  /* Fechado: sem saber o que já saiu hoje, nada é reservado — mandar em cima de um
   * limite que ninguém conferiu seria pior. O que este teste prende é de quem é a
   * culpa: quem caiu foi o banco DA APP, e um `SdrDbError` diria ao operador que a base
   * do SDR (a do CLIENTE) está fora. Motivo próprio, e o erro original preservado para
   * o log de quem chamou. */
  const acaoId = await cenarioCompleto()
  const queda = new Error('o banco da app caiu')

  const lote = await selecionarDevidos(CONN, {
    tenantId: TENANT,
    config: CONFIG,
    agora: QUARTA_MEIO_DIA,
    contarEnviadosHoje: async () => { throw queda },
  })

  assert.equal(lote.motivo, 'contagem_indisponivel')
  assert.equal(lote.limite.falha, queda, 'o erro cru sobrevive, para o servidor logar')
  assert.equal(lote.limite.enviadosHoje, null)
  assert.equal(lote.limite.disponivel, null)
  assert.deepEqual(consultas, [], 'a base do cliente nem chega a ser consultada')
  assert.equal((await acao(acaoId)).ativo, true, 'e nada foi reservado')
})

test('contagem que responde bobagem é recusada — nas duas direções', async () => {
  /* `NaN` atravessaria a subtração e chegaria ao `LIMIT $3::int`: o Postgres recusa a
   * instrução, e o operador lê "não foi possível falar com a base do SDR" por causa de
   * uma conta NOSSA. `null` faria a subtração devolver a cota inteira — o limite
   * diário desligado em silêncio. Nenhuma das duas passa. */
  const acaoId = await cenarioCompleto()

  for (const resposta of [NaN, null, undefined, -1, 1.5, 'oito']) {
    const lote = await selecionarDevidos(CONN, {
      tenantId: TENANT,
      config: CONFIG,
      agora: QUARTA_MEIO_DIA,
      contarEnviadosHoje: async () => resposta as unknown as number,
    })
    assert.equal(lote.motivo, 'contagem_invalida', `contagem ${String(resposta)}`)
  }

  assert.deepEqual(consultas, [], 'nenhuma delas reserva nada')
  assert.equal((await acao(acaoId)).ativo, true)

  // E o texto que o `pg` devolve num `count(*)` (é `bigint`) continua servindo.
  const comTexto = await selecionarDevidos(CONN, {
    tenantId: TENANT,
    config: com({ limite_diario: 10 }),
    agora: QUARTA_MEIO_DIA,
    contarEnviadosHoje: async () => '8' as unknown as number,
  })
  assert.equal(comTexto.limite.enviadosHoje, 8)
  assert.equal(comTexto.limite.disponivel, 2)
})

test('a contagem se declara INCOMPLETA enquanto o cron antigo do n8n existir', async () => {
  /* O fluxo antigo não passa por reserva (não escreve `dispatch_claims`) nem manda ack
   * (não escreve `blast_recipients`): ele não aparece em NENHUM dos dois lugares, então
   * nenhuma porta que o chamador passe consegue vê-lo. O que a app conta é um PISO, não o
   * total. Desligar o cron antigo é o commit que troca esta bandeira por false — este
   * teste é o lembrete de que a troca existe, e de que ligar o livro-caixa NÃO é ela. */
  assert.equal(CONTAGEM_INCOMPLETA, true)
  await cenarioCompleto()
  assert.equal((await motivoDe(CONFIG)).limite.incompleta, true)
})

test('a cota sai da porta, e de lugar nenhum além dela', async () => {
  /* A porta não é mais "substituição" de nada: é a ÚNICA fonte da contagem. O módulo não
   * fala com o banco da app — não importa lib/db —, então um número que não venha daqui
   * não vem de parte alguma. */
  await cenarioCompleto()

  const lote = await selecionarDevidos(CONN, {
    tenantId: TENANT,
    config: com({ limite_diario: 4 }),
    agora: QUARTA_MEIO_DIA,
    contarEnviadosHoje: async () => 3,
  })

  assert.equal(lote.limite.enviadosHoje, 3)
  assert.equal(lote.limite.disponivel, 1)
  assert.equal(lote.enviar.length, 1, 'e é esse número que decide o tamanho do lote')
})

test('a porta recebe o tenant e o instante DA RODADA, para achar o balde certo', async () => {
  /* Em produção é `contarConsumidasHoje` que está do outro lado, e ela recorta por
   * `baldeDoDia(tenantId, agora)`. Se a régua passasse `new Date()` em vez do `agora` do
   * pedido, a cota conferida seria a de um dia e a reserva cairia na de outro — às 21h de
   * Brasília, todo dia. */
  await cenarioCompleto()
  const vistos: Array<{ tenantId: string; agora: number }> = []

  await selecionarDevidos(CONN, {
    tenantId: TENANT,
    config: CONFIG,
    agora: QUARTA_MEIO_DIA,
    contarEnviadosHoje: async (tenantId, agora) => {
      vistos.push({ tenantId, agora: agora.getTime() })
      return 0
    },
  })

  assert.deepEqual(vistos, [{ tenantId: TENANT, agora: QUARTA_MEIO_DIA.getTime() }])
})

test('porta de contagem AUSENTE é motivo próprio — e vem antes de todas as recusas', async () => {
  /* O tipo já recusa isto: `contarEnviadosHoje` é obrigatória em `PedidoDaRegua`, e é
   * assim que a CONTA DUPLA de lib/sdr/reservas fica impossível de cometer por omissão —
   * não existe default errado para esquecer de trocar.
   *
   * O `as` encena o chamador que o compilador não alcança: rota montando o pedido a partir
   * de JSON, um `any` no meio, chamada vinda de JavaScript. E os chamadores deste módulo
   * SÃO rotas, que neste repositório não têm teste — este é o teste delas. Sem a guarda o
   * que sai daqui é um `TypeError` cru do meio da função, ou seja, o zero sem nome que o
   * módulo inteiro existe para abolir. */
  const acaoId = await cenarioCompleto()

  const semPorta = {
    tenantId: TENANT, config: CONFIG, agora: QUARTA_MEIO_DIA,
  } as unknown as PedidoDaRegua

  const lote = await selecionarDevidos(CONN, semPorta)

  assert.equal(lote.motivo, 'contagem_nao_fornecida')
  assert.deepEqual(lote.enviar, [])
  assert.equal(lote.reservadas, 0)
  assert.deepEqual(consultas, [], 'sem saber a cota, a base do cliente nem é aberta')
  assert.equal((await acao(acaoId)).ativo, true, 'e nada foi reservado')
  // A janela vai no resultado como em qualquer outra recusa: o operador continua sabendo
  // que horas a régua achou que eram.
  assert.equal(lote.janela.horaLocal, '12:00')
  assert.equal(lote.limite.enviadosHoje, null, 'ninguém contou')
  assert.equal(lote.limite.disponivel, null)

  // Valor que não é função cai no mesmo lugar: `null` de um JSON, número trocado de campo.
  for (const naoEhPorta of [undefined, null, 42, 'contar', {}]) {
    const torto = await selecionarDevidos(CONN, {
      ...semPorta, contarEnviadosHoje: naoEhPorta,
    } as unknown as PedidoDaRegua)
    assert.equal(torto.motivo, 'contagem_nao_fornecida', `porta ${String(naoEhPorta)}`)
  }

  /* E o motivo é ESTE mesmo com a campanha desligada, que é a recusa mais antiga do
   * módulo. A ordem é escolhida: "campanha inativa" é estado da campanha e pode ser
   * verdade de novo amanhã; porta faltando é defeito de código. Posta depois das outras,
   * ela só apareceria na primeira rodada que chegasse à contagem — a primeira rodada em
   * que mensagens sairiam de verdade, que é o pior instante para descobrir. */
  const desligada = await selecionarDevidos(CONN, {
    ...semPorta, config: com({ ativo: false }),
  } as unknown as PedidoDaRegua)
  assert.equal(desligada.motivo, 'contagem_nao_fornecida')

  // Inclusive quando o limite é zero, que é o outro caminho que dispensa contar.
  const zero = await selecionarDevidos(CONN, {
    ...semPorta, config: com({ limite_diario: 0 }),
  } as unknown as PedidoDaRegua)
  assert.equal(zero.motivo, 'contagem_nao_fornecida')
})

// ─── Seleção e forma do destinatário ──────────────────────────────────────────

test('o destinatário sai na forma exata que a rota de blast manda ao n8n', async () => {
  await semearLead(LEAD_A, 'Ana Paula', '+5511999990000', '5511999990000')
  await semearTemplate('Template 1', 'tpl_1', 'Oi {{1}}, tudo bem?')
  const acaoId = await semearAcao(LEAD_A, 'Template 1')

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'ok')
  assert.deepEqual(lote.enviar[0], {
    leadId:     LEAD_A,
    phone:      '+5511999990000',
    first_name: 'Ana',
    message:    'Oi Ana, tudo bem?',
    session_id: '5511999990000',
    acaoId,
    fase:       'Template 1',
    idFase:     1,
    template:   'tpl_1',
  })
})

test('celular antigo sem o nono dígito ganha o 9, como no blast', async () => {
  await semearLead(LEAD_A, 'Ana', null, '551188887777')  // 55 + DDD 11 + 8 dígitos
  await semearTemplate('Template 1')
  await semearAcao(LEAD_A, 'Template 1')

  const lote = await motivoDe(CONFIG)
  assert.equal(lote.enviar[0].phone, '+5511988887777')
  // O session_id continua sendo o número COMO ESTÁ GUARDADO, sem o 9 — é ele que
  // casa com a conversa no histórico, e mexer aqui separaria lead e conversa.
  assert.equal(lote.enviar[0].session_id, '551188887777')
})

test('a fase FINAL não dispara: a campanha para NELA — desvio conhecido, preservado', async () => {
  /* `fase <> fase_final` é o filtro do n8n, letra por letra: quem configura 5 toques
   * recebe 4 mensagens. Parece um erro de um a menos, e provavelmente é — mas
   * consertar muda quantas mensagens pessoas reais recebem, e essa conta é do dono do
   * produto. O teste existe para que a mudança seja deliberada, não acidental. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 5', 'tpl_5')
  const acaoId = await semearAcao(LEAD_A, 'Template 5')

  const lote = await motivoDe(com({ fase_final: 'Template 5' }))

  assert.equal(lote.motivo, 'nada_devido')
  assert.equal((await acao(acaoId)).ativo, true, 'nem reservada ela é')
})

test('ação ainda não vencida fica para depois', async () => {
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 1')
  await semearAcao(LEAD_A, 'Template 1', { vencidaHa: '-2 hours' })

  assert.equal((await motivoDe(CONFIG)).motivo, 'nada_devido')
})

test('ação vencida EXATAMENTE agora está vencida — a borda é inclusiva', async () => {
  /* O SQL compara com `<=`. Com `<`, o lead agendado para as 12:00 em ponto esperaria a
   * rodada seguinte — e num cron de três em três horas isso é a mensagem saindo horas
   * depois do combinado, sem nada quebrado em lugar nenhum. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 1')
  const acaoId = await semearAcao(LEAD_A, 'Template 1', { vencidaHa: '0 hours' })

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'ok')
  assert.equal(lote.enviar[0].acaoId, acaoId)
})

test('ação inativa (ou com ativo NULL) não entra — e quem a exclui é o SELECT', async () => {
  /* O filtro é `a.ativo = true`, literal como no n8n: `false` e NULL ficam de fora.
   *
   * Provar isso com "o lote veio vazio" NÃO prova nada. Com o filtro afrouxado para
   * `ativo IS NOT false`, a linha NULL É selecionada e travada, e quem a derruba é o
   * `AND a.ativo = true` do UPDATE — o lote vem vazio do mesmo jeito e o teste passa
   * pelo motivo errado. O que separa os dois casos é a VAGA: uma linha selecionada
   * consome uma das `LIMIT $3`. Com a cota em 1 e as linhas ruins na frente da fila, o
   * filtro certo entrega a mensagem boa; o filtro afrouxado gasta a vaga com a linha
   * NULL e não entrega nada. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno', '+5511988880000')
  await semearLead(LEAD_C, 'Carla', '+5511977770000')
  await semearTemplate('Template 1')
  const inativa = await semearAcao(LEAD_A, 'Template 1', { ativo: false, vencidaHa: '9 hours' })
  const nula = await semearAcao(LEAD_B, 'Template 1', { ativo: null, vencidaHa: '8 hours' })
  await semearAcao(LEAD_C, 'Template 1', { vencidaHa: '1 hour' })

  const lote = await motivoDe(com({ limite_diario: 1 }))

  assert.equal(lote.motivo, 'ok')
  assert.deepEqual(lote.enviar.map(d => d.leadId), [LEAD_C], 'a única vaga foi para a linha ativa')
  assert.equal(lote.reservadas, 1)
  assert.equal((await acao(inativa)).ativo, false, 'a inativa continua como estava')
  assert.equal((await acao(nula)).ativo, null, 'e a NULL não virou false')
})

// ─── Linha com `fase` NULL: continua fora da fila, deixa de ser invisível ─────

test('linha com fase NULL não é reservada — e sai CONTADA em devidosSemFase', async () => {
  /* Em lógica de três valores, `fase <> fase_final` é NULL quando a fase é NULL: a
   * linha não passa pelo filtro. Nunca é selecionada, nunca reservada, nunca
   * descartada, e fica `ativo = true` para sempre — o lead sai da campanha em silêncio.
   * Trocar por `IS DISTINCT FROM` mudaria QUEM recebe mensagem, e essa conta é do dono
   * do produto. Então ela continua fora; o que muda é que o lote a declara. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno', '+5511988880000')
  await semearTemplate('Template 1')
  const comFase = await semearAcao(LEAD_A, 'Template 1', { vencidaHa: '1 hour' })
  const semFase = await semearAcao(LEAD_B, null, { vencidaHa: '5 hours' })

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'ok')
  // A sem fase é a MAIS VELHA da fila: com `IS DISTINCT FROM` ela viria primeiro, seria
  // reservada e cairia em `descartados` por não achar template.
  assert.deepEqual(lote.enviar.map(d => d.acaoId), [comFase])
  assert.equal(lote.reservadas, 1)
  assert.deepEqual(lote.descartados, [], 'descarte pressupõe reserva, e aqui não houve')
  assert.equal(lote.devidosSemFase, 1, 'mas o operador fica sabendo que ela existe')
  assert.equal((await acao(semFase)).ativo, true, 'e ela continua parada onde estava')
})

test('devidosSemFase conta só quem está parado AGORA — e é null quando ninguém olhou', async () => {
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 1')
  await semearAcao(LEAD_A, 'Template 1')
  // Sem fase, mas não devidas: a futura ainda vai chegar, e as sem `ativo = true` já
  // saíram da campanha por outro caminho.
  await semearAcao(LEAD_B, null, { vencidaHa: '-2 hours' })
  await semearAcao(LEAD_C, null, { ativo: false })
  await semearAcao(LEAD_C, null, { ativo: null })

  assert.equal((await motivoDe(CONFIG)).devidosSemFase, 0, 'olhou e não achou nenhuma parada')

  /* E `null` não é zero: a campanha desligada não chega a consultar a base do cliente,
   * então ninguém olhou. Dizer "zero" aqui seria inventar um censo que não houve. */
  assert.equal((await motivoDe(com({ ativo: false }))).devidosSemFase, null)
})

// ─── Descartes: cada um com o seu nome ────────────────────────────────────────

test('fase sem template no cadastro vira template_ausente — não falha de TELEFONE', async () => {
  /* Hoje a falta chega ao YCloud como erro e é registrada como falha de telefone, o
   * que manda quem for depurar para o lugar errado: o número está perfeito, o que
   * falta é uma linha em meta_templates_whatsapp. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 2')  // existe, mas para OUTRA fase
  const acaoId = await semearAcao(LEAD_A, 'Template 1')

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'todos_descartados')
  assert.deepEqual(lote.descartados, [
    { acaoId, leadId: LEAD_A, fase: 'Template 1', motivo: 'template_ausente' },
  ])
  // A linha FOI reservada: descarte não é "não aconteceu", é dívida a devolver.
  assert.equal(lote.reservadas, 1)
  assert.equal((await acao(acaoId)).ativo, false)
})

test('template cadastrado com corpo vazio conta como ausente', async () => {
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 1', 'tpl_1', '')
  await semearAcao(LEAD_A, 'Template 1')

  assert.equal((await motivoDe(CONFIG)).descartados[0].motivo, 'template_ausente')
})

test('a fase com VÁRIOS templates escolhe por rank_disparo, e desempata pelo nome', async () => {
  /* Cadastro real tem mais de uma linha por fase. Sem `ORDER BY`, o `LIMIT 1` pega o
   * que o banco devolver — que é a ordem física da tabela e muda sozinha com um UPDATE
   * ou um VACUUM: a campanha trocaria de template sem ninguém ter mexido em nada. Os
   * perdedores são semeados PRIMEIRO de propósito, porque é isso que a varredura crua
   * devolveria. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 1', 'tpl_rank9',     'Oi {{1}}, sou o 9',     9)
  await semearTemplate('Template 1', 'tpl_sem_rank',  'Oi {{1}}, não tenho rank', null)
  await semearTemplate('Template 1', 'tpl_rank1_b',   'Oi {{1}}, sou o 1 b',   1)
  await semearTemplate('Template 1', 'tpl_rank1_a',   'Oi {{1}}, sou o 1 a',   1)
  await semearAcao(LEAD_A, 'Template 1')

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'ok')
  // rank 1 ganha do 9 e do sem rank (NULLS LAST); o empate no rank cai no nome.
  assert.equal(lote.enviar[0].template, 'tpl_rank1_a')
  assert.equal(lote.enviar[0].message, 'Oi Ana, sou o 1 a')
})

test('template pela metade não SOMBREIA o template bom da mesma fase', async () => {
  /* Nome NULL e corpo vazio são recusados NO SQL, não só no JS. A diferença aparece
   * quando o mal cadastrado tem o melhor rank: com as guardas, o `LIMIT 1` pula para o
   * próximo e o lead recebe; sem elas, o meio-template ganha a ordenação, chega ao JS e
   * o lead vira `template_ausente` — com a fase tendo um template perfeito ao lado. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearTemplate('Template 1', 'tpl_vazio', '',                     1)
  await semearTemplate('Template 1', null,        'Oi {{1}}, sem nome',   2)
  await semearTemplate('Template 1', 'tpl_bom',   'Oi {{1}}, tudo bem?',  3)
  await semearAcao(LEAD_A, 'Template 1')

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'ok', 'a fase tem template bom — o lead não pode ser descartado')
  assert.equal(lote.enviar[0].template, 'tpl_bom')
  assert.equal(lote.enviar[0].message, 'Oi Ana, tudo bem?')
})

test('lead sem telefone utilizável é descartado com o seu próprio motivo', async () => {
  await semearLead(LEAD_A, 'Ana', null, null)
  await semearTemplate('Template 1')
  await semearAcao(LEAD_A, 'Template 1')

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'todos_descartados')
  assert.equal(lote.descartados[0].motivo, 'sem_telefone')
})

test('lead sem nome NÃO recebe template que usa nome — e recebe o que não usa', async () => {
  // Não existe saudação de reserva: inventar nome faz a mensagem mentir para o lead.
  await semearLead(LEAD_A, null, '+5511999990000')
  await semearLead(LEAD_B, '   ', '+5511988880000')
  await semearTemplate('Template 1', 'tpl_com_nome', 'Oi {{1}}, tudo bem?')
  await semearAcao(LEAD_A, 'Template 1')
  await semearAcao(LEAD_B, 'Template 1')

  const comNome = await motivoDe(CONFIG)
  assert.equal(comNome.motivo, 'todos_descartados')
  assert.deepEqual(comNome.descartados.map(d => d.motivo), ['sem_nome', 'sem_nome'])

  // Mesmo cenário, template SEM variável: agora eles recebem.
  await cliente.exec('TRUNCATE lead_actions; TRUNCATE meta_templates_whatsapp;')
  await semearTemplate('Template 1', 'tpl_sem_nome', 'Temos uma novidade para você.')
  await semearAcao(LEAD_A, 'Template 1')

  const semNome = await motivoDe(CONFIG)
  assert.equal(semNome.motivo, 'ok')
  assert.equal(semNome.enviar[0].message, 'Temos uma novidade para você.')
  assert.equal(semNome.enviar[0].first_name, '')
})

test('placeholder que sobra derruba só aquele destinatário, não o lote', async () => {
  /* A rota de blast derruba o pedido inteiro, porque lá todo mundo recebe o mesmo
   * template. Aqui cada fase tem o seu, então um template mal cadastrado não pode
   * calar os outros. O que não muda é que a mensagem com `{{...}}` literal não sai. */
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno', '+5511988880000')
  await semearTemplate('Template 1', 'tpl_1', 'Oi {{1}}, tudo bem?')
  await semearTemplate('Template 2', 'tpl_2', 'Oi {{1}}, sobre a {{2}}?')
  await semearAcao(LEAD_A, 'Template 1', { vencidaHa: '2 hours' })
  await semearAcao(LEAD_B, 'Template 2', { vencidaHa: '1 hour' })

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'ok')
  assert.deepEqual(lote.enviar.map(d => d.leadId), [LEAD_A])
  assert.deepEqual(lote.descartados.map(d => d.motivo), ['variavel_sem_valor'])
})

test('lead_actions apontando para lead que sumiu vira lead_ausente', async () => {
  await semearTemplate('Template 1')
  await semearAcao(LEAD_SUMIDO, 'Template 1')

  const lote = await motivoDe(CONFIG)

  assert.equal(lote.motivo, 'todos_descartados')
  assert.equal(lote.descartados[0].motivo, 'lead_ausente')
})

// ─── A reserva ────────────────────────────────────────────────────────────────

test('selecionar RESERVA: a linha sai com ativo = false e o cron antigo não a vê mais', async () => {
  const acaoId = await cenarioCompleto()

  assert.equal((await acao(acaoId)).ativo, true)
  const lote = await motivoDe(CONFIG)

  assert.equal(lote.enviar[0].acaoId, acaoId)
  assert.equal((await acao(acaoId)).ativo, false, 'reservada')
  assert.equal((await acao(acaoId)).fase, 'Template 1', 'a fase NÃO avança aqui — isso é do ack')

  // E uma segunda chamada não a pega de novo.
  assert.equal((await motivoDe(CONFIG)).motivo, 'nada_devido')
})

test('selecionar e reservar são UMA instrução só', async () => {
  // A contagem de consultas é o que prende a atomicidade: nenhuma asserção sobre o
  // conteúdo das linhas percebe uma implementação de SELECT seguido de UPDATE.
  await cenarioCompleto()
  consultas = []

  await motivoDe(CONFIG)

  assert.equal(consultas.length, 1, 'uma consulta à base do cliente, e só')
})

test('a reserva confere `ativo` também na hora de ESCREVER', async () => {
  /* Dentro de UMA instrução, o `AND a.ativo = true` do UPDATE é redundante: o que a CTE
   * selecionou é o que o UPDATE vê, e não existe intercalação no meio de uma instrução.
   * Por isso nenhum teste de comportamento distingue a versão com e sem a guarda — foi
   * assim que ela sumiu uma vez, sem nada ficar vermelho.
   *
   * Ela não é enfeite: é a segunda tranca da mesma porta. No instante em que alguém
   * afrouxar o filtro da CTE (`ativo IS NOT false` é o afrouxamento óbvio), ela passa a
   * ser a ÚNICA coisa que impede uma linha com `ativo` NULL de ser reservada. Como o
   * comportamento não a alcança, o que se prende aqui é o texto que foi ao banco — o
   * mesmo recurso que o teste de injeção usa. */
  await cenarioCompleto()
  await motivoDe(CONFIG)

  assert.equal(consultas.length, 1)
  const sql = consultas[0]
  const update = sql.slice(sql.indexOf('UPDATE lead_actions'))
  assert.match(update, /SET ativo = false[\s\S]*?WHERE a\.id = d\.id AND a\.ativo = true/)
})

test('duas seleções simultâneas NÃO reservam a mesma linha', async () => {
  /* O cron antigo continua rodando enquanto este caminho é usado à mão. Se os dois
   * pegarem a mesma `lead_actions`, alguém recebe a mesma mensagem duas vezes.
   *
   * O portão segura as duas chamadas até que AMBAS tenham entregado o seu comando ao
   * banco — é o pior instante possível. Com uma instrução cada, a segunda encontra
   * `ativo = false` e volta vazia. Uma implementação em duas instruções intercalaria
   * aqui e reservaria a linha duas vezes. */
  const acaoId = await cenarioCompleto()

  portao = portaoPara(2)
  const [a, b] = await Promise.all([motivoDe(CONFIG), motivoDe(CONFIG)])
  portao = null

  const reservadas = [...a.enviar, ...b.enviar].map(d => d.acaoId)
  assert.deepEqual(reservadas, [acaoId], 'exatamente uma reserva, para a única linha devida')
  assert.equal(a.reservadas + b.reservadas, 1)

  const vazia = a.enviar.length === 0 ? a : b
  assert.equal(vazia.motivo, 'nada_devido', 'quem perdeu a corrida recebe um motivo, não um erro')
  assert.equal(consultas.length, 2, 'uma instrução por chamada')
})

test('duas seleções simultâneas dividem a fila sem sobreposição', async () => {
  await semearLead(LEAD_A, 'Ana', '+5511999990000')
  await semearLead(LEAD_B, 'Bruno', '+5511988880000')
  await semearTemplate('Template 1')
  await semearAcao(LEAD_A, 'Template 1', { vencidaHa: '2 hours' })
  await semearAcao(LEAD_B, 'Template 1', { vencidaHa: '1 hour' })

  portao = portaoPara(2)
  const [a, b] = await Promise.all([motivoDe(CONFIG), motivoDe(CONFIG)])
  portao = null

  const ids = [...a.enviar, ...b.enviar].map(d => d.acaoId)
  assert.equal(ids.length, 2)
  assert.equal(new Set(ids).size, 2, 'nenhuma linha reservada duas vezes')
})

// ─── Devolver a reserva ───────────────────────────────────────────────────────

test('devolverReservas põe o lead de volta na fila, na mesma fase', async () => {
  /* Sem isto, um lote em que o n8n não respondeu deixaria todo mundo com
   * `ativo = false`: leads fora da campanha para sempre, sem erro em lugar nenhum. */
  const acaoId = await cenarioCompleto()
  const lote = await motivoDe(CONFIG)
  assert.equal((await acao(acaoId)).ativo, false)

  const voltaram = await devolverReservas(CONN, lote.enviar.map(d => d.acaoId))

  assert.equal(voltaram, 1)
  assert.equal((await acao(acaoId)).ativo, true)
  assert.equal((await acao(acaoId)).fase, 'Template 1')
  // E aí a régua a encontra de novo.
  assert.equal((await motivoDe(CONFIG)).motivo, 'ok')
})

test('devolver uma reserva que já voltou não conta duas vezes', async () => {
  const acaoId = await cenarioCompleto()
  await motivoDe(CONFIG)

  assert.equal(await devolverReservas(CONN, [acaoId]), 1)
  assert.equal(await devolverReservas(CONN, [acaoId]), 0)
})

test('devolver lista vazia (ou só com lixo) não consulta o banco', async () => {
  consultas = []
  assert.equal(await devolverReservas(CONN, []), 0)
  assert.equal(await devolverReservas(CONN, ['', '   '] as string[]), 0)
  assert.deepEqual(consultas, [])
})

// ─── Nada de SQL montado com texto ────────────────────────────────────────────

test('a fase_final vai como parâmetro: aspas viram dado, não comando', async () => {
  await cenarioCompleto()

  const lote = await motivoDe(com({ fase_final: `Template 5'); DROP TABLE lead_actions; --` }))

  assert.equal(lote.motivo, 'ok')
  assert.equal(consultas.length, 1)
  assert.ok(!consultas[0].includes('DROP'))
  // A tabela continua de pé.
  assert.equal((await acao(lote.enviar[0].acaoId)).fase, 'Template 1')
})
