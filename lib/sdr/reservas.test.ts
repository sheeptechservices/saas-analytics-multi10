// Testes do livro-caixa de reservas (lib/sdr/reservas) contra Postgres DE VERDADE.
//
// PGlite — o Postgres compilado para WASM — com as MIGRAÇÕES REAIS de `drizzle/`, pelo
// harness de test-support/pglite. Não há DDL escrito à mão aqui, e isso não é
// preferência de estilo: duas das invariantes deste módulo são do BANCO, não do
// TypeScript, e um schema imitado provaria a imitação.
//
//   · o índice único PARCIAL que proíbe duas reservas vivas para a mesma `lead_actions`.
//     Se a migração de `drizzle/0001_dispatch_claims.sql` estiver errada — predicado
//     trocado, índice não-parcial, coluna errada —, é AQUI que se descobre, e não em
//     produção com alguém recebendo a mesma mensagem duas vezes;
//   · o `WHERE status = 'reservada'` dos UPDATEs, que só atinge uma linha PORQUE aquele
//     índice existe.
//
// O banco é só o DA APP. Ao contrário de lib/sdr/regua.test, não há segundo banco nem
// fábrica de pools: este módulo não fala com a base do cliente, então lib/sdr/pg não
// entra em cena e nenhuma string de conexão é necessária.

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'
import {
  STATUS_QUE_CONSOMEM,
  contarConsumidasHoje,
  liquidarComoEnviada,
  liquidarComoFalha,
  listarReservasParadas,
  marcarDevolvidas,
  registrarReservas,
  type NovaReserva,
} from '@/lib/sdr/reservas'
import { dispatchClaims, tenants } from '@/lib/db/schema'

const TENANT = 'tenant-reservas'
const OUTRO_TENANT = 'tenant-vizinho'

/* Quarta-feira, 12:00 em São Paulo (15:00 em UTC) — o instante "sem graça" contra o
 * qual as bordas de fuso lá embaixo são comparadas. */
const QUARTA_MEIO_DIA = new Date('2026-09-23T15:00:00Z')

let app: BancoDeTeste

before(async () => {
  app = await bancoDeTeste()
  usarComoBancoDoApp(app.db)
  await app.db.insert(tenants).values([
    { id: TENANT, name: 'Reservas', slug: 'reservas', createdAt: new Date() },
    { id: OUTRO_TENANT, name: 'Vizinho', slug: 'vizinho', createdAt: new Date() },
  ])
})

after(async () => {
  soltarBancoDoApp()
  await app.fechar()
})

beforeEach(async () => {
  await app.pg.exec('TRUNCATE dispatch_claims;')
})

// ─── Semeadura ────────────────────────────────────────────────────────────────

/** Uma reserva como a régua a devolve. O `acaoId` é um uuid porque é o que
 *  `lead_actions.id` é na base do cliente — aqui a coluna é `text`, mas escrever o
 *  formato errado no teste esconderia uma incompatibilidade no dia da ligação. */
function reserva(acaoId: string, opts: Partial<NovaReserva> = {}): NovaReserva {
  return {
    acaoId,
    leadId: 'aaaaaaaa-1111-4111-8111-111111111111',
    fase: 'Template 1',
    idFase: 1,
    ...opts,
  }
}

const ACAO_A = 'a0000000-0000-4000-8000-000000000001'
const ACAO_B = 'a0000000-0000-4000-8000-000000000002'
const ACAO_C = 'a0000000-0000-4000-8000-000000000003'

async function linhas() {
  return app.db.select().from(dispatchClaims).orderBy(dispatchClaims.leadActionId)
}

async function linhaDe(acaoId: string) {
  const [linha] = await app.db
    .select().from(dispatchClaims).where(eq(dispatchClaims.leadActionId, acaoId))
  return linha
}

/**
 * O balde do dia RECALCULADO a partir de app/api/sdr/dispatch/ack/route.ts, linha por
 * linha — `toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })` sem hífens,
 * prefixado pelo tenant.
 *
 * Copiado de propósito, e é a única cópia defensável do repositório: comparar a função
 * do módulo com ela mesma não provaria nada. A ÚNICA diferença em relação ao ack é que
 * ali o instante é `new Date()` (o ack não tem relógio injetável) e aqui ele é
 * parâmetro, porque as bordas de fuso precisam escolher o instante.
 *
 * Se algum dia esta função e a do ack divergirem, o teste fica vermelho — que é
 * exatamente o alarme que falta hoje: divergir não dá erro nenhum em produção, dá uma
 * contagem eternamente zero, ou seja, limite diário nenhum.
 */
/** A mensagem do erro e a de toda a cadeia de `cause`. O drizzle embrulha o erro do
 *  driver: por fora fica o SQL que falhou, e o nome do índice violado só aparece no
 *  original, lá dentro. Olhar só o de cima faria o teste passar por qualquer falha. */
function textoDoErro(erro: unknown): string {
  const partes: string[] = []
  let atual: unknown = erro
  while (atual instanceof Error) {
    partes.push(atual.message)
    atual = atual.cause
  }
  return partes.join(' | ')
}

function baldeDoAck(tenantId: string, agora: Date): string {
  const yyyymmdd = agora
    .toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    .replace(/-/g, '')
  return `${tenantId}:drip:${yyyymmdd}`
}

// ─── Registrar ────────────────────────────────────────────────────────────────

test('registrar um lote grava uma linha por reserva, em voo', async () => {
  const gravadas = await registrarReservas(TENANT, QUARTA_MEIO_DIA, [
    reserva(ACAO_A),
    reserva(ACAO_B, { leadId: 'bbbbbbbb-2222-4222-8222-222222222222', fase: 'Template 2', idFase: 2 }),
  ])
  assert.equal(gravadas, 2)

  const todas = await linhas()
  assert.equal(todas.length, 2)

  const a = todas[0]
  assert.equal(a.tenantId, TENANT)
  assert.equal(a.leadActionId, ACAO_A)
  assert.equal(a.leadId, 'aaaaaaaa-1111-4111-8111-111111111111')
  assert.equal(a.phase, 'Template 1')
  assert.equal(a.phaseNumber, 1)
  assert.equal(a.status, 'reservada')
  // Em voo é isto: sem messageId e sem carimbo de desfecho. É por `settledAt` NULL que
  // a varredura de reserva parada acha as velhas.
  assert.equal(a.ycloudMessageId, null)
  assert.equal(a.settledAt, null)
  assert.deepEqual(a.claimedAt, QUARTA_MEIO_DIA)

  assert.equal(todas[1].phase, 'Template 2')
  assert.equal(todas[1].phaseNumber, 2)
})

test('registrar aceita fase sem número (o schema do cliente não é nosso)', async () => {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A, { idFase: null })])
  assert.equal((await linhaDe(ACAO_A)).phaseNumber, null)
})

test('lote vazio não grava nada e devolve zero', async () => {
  assert.equal(await registrarReservas(TENANT, QUARTA_MEIO_DIA, []), 0)
  assert.equal((await linhas()).length, 0)
})

// ─── A COTA: o defeito que este módulo existe para matar ──────────────────────

test('a contagem inclui reserva EM VOO — o ponto inteiro do módulo', async () => {
  /* A contagem antiga (`blast_recipients` no balde do dia) só enxerga o que o ack já
   * escreveu. Aqui NADA foi enviado, nenhum ack chegou, `blast_recipients` está vazia —
   * e mesmo assim três vagas já estão comprometidas. É esta diferença que impede a
   * segunda rodada de receber a cota inteira de novo e um limite de 10 virar 20. */
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [
    reserva(ACAO_A), reserva(ACAO_B), reserva(ACAO_C),
  ])

  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 3)
})

test('a contagem é do tenant e do dia — vizinho e outro dia não entram', async () => {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])
  await registrarReservas(OUTRO_TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_B)])
  // Quinta-feira, mesmo tenant.
  await registrarReservas(TENANT, new Date('2026-09-24T15:00:00Z'), [reserva(ACAO_C)])

  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1)
  assert.equal(await contarConsumidasHoje(OUTRO_TENANT, QUARTA_MEIO_DIA), 1)
  assert.equal(await contarConsumidasHoje(TENANT, new Date('2026-09-24T15:00:00Z')), 1)
})

test('reserva DEVOLVIDA para de gastar a cota', async () => {
  // O lead voltou para a fila e será selecionado de novo: contar seria cobrar duas
  // vezes pela mesma mensagem.
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A), reserva(ACAO_B)])
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 2)

  assert.equal(await marcarDevolvidas([ACAO_A], QUARTA_MEIO_DIA), 1)
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1)

  const a = await linhaDe(ACAO_A)
  assert.equal(a.status, 'devolvida')
  assert.deepEqual(a.settledAt, QUARTA_MEIO_DIA)
})

test('reserva que FALHOU não gasta a cota — decisão, com os dois lados escritos', async () => {
  /* CONTANDO a falha, meia hora de YCloud fora às 9h comeria a permissão do dia inteiro
   * e o operador leria `limite_diario_atingido`, que seria falso. NÃO CONTANDO, uma
   * configuração que falha sempre deixa cada rodada tentar a cota de novo — risco real,
   * e que é de um disjuntor, não da cota. Ver STATUS_QUE_CONSOMEM em lib/sdr/reservas.
   *
   * Este teste é o que prende a decisão: mudá-la exige mudar este arquivo, em voz alta. */
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A), reserva(ACAO_B)])

  assert.equal(await liquidarComoFalha(ACAO_A, QUARTA_MEIO_DIA), 1)
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1)

  const a = await linhaDe(ACAO_A)
  assert.equal(a.status, 'falhou')
  assert.deepEqual(a.settledAt, QUARTA_MEIO_DIA)
  // A falha fica REGISTRADA — é o que torna um disjuntor possível depois.
  assert.equal(a.ycloudMessageId, null)

  // E o vocabulário que a cota usa é o mesmo que os testes acima assumem.
  assert.deepEqual([...STATUS_QUE_CONSOMEM], ['reservada', 'enviada'])
})

// ─── Liquidar ─────────────────────────────────────────────────────────────────

test('liquidar como enviada guarda o messageId e continua gastando a cota', async () => {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])
  const depois = new Date('2026-09-23T15:00:30Z')

  assert.equal(await liquidarComoEnviada(ACAO_A, 'msg_abc123', depois), 1)

  const a = await linhaDe(ACAO_A)
  assert.equal(a.status, 'enviada')
  assert.equal(a.ycloudMessageId, 'msg_abc123')
  assert.deepEqual(a.settledAt, depois)
  // O carimbo da reserva NÃO é reescrito: é ele que datou a vaga.
  assert.deepEqual(a.claimedAt, QUARTA_MEIO_DIA)

  // Enviada continua consumindo — a vaga virou mensagem, não voltou para o estoque.
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1)
})

test('liquidar duas vezes não reescreve o desfecho, e devolução atrasada não desfaz envio', async () => {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])
  const primeiro = new Date('2026-09-23T15:00:30Z')
  const segundo = new Date('2026-09-23T15:05:00Z')

  assert.equal(await liquidarComoEnviada(ACAO_A, 'msg_abc123', primeiro), 1)

  // Ack repetido: zero linhas mudadas, e isso NÃO é erro — é informação.
  assert.equal(await liquidarComoEnviada(ACAO_A, 'msg_OUTRO', segundo), 0)
  assert.equal(await liquidarComoFalha(ACAO_A, segundo), 0)
  assert.equal(await marcarDevolvidas([ACAO_A], segundo), 0)

  const a = await linhaDe(ACAO_A)
  assert.equal(a.status, 'enviada')
  assert.equal(a.ycloudMessageId, 'msg_abc123')
  assert.deepEqual(a.settledAt, primeiro)
})

test('devolver em lote atinge só o que está em voo', async () => {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [
    reserva(ACAO_A), reserva(ACAO_B), reserva(ACAO_C),
  ])
  await liquidarComoEnviada(ACAO_C, 'msg_ja_foi', QUARTA_MEIO_DIA)

  // Três pedidos, dois em voo: devolve 2. Menos que o pedido não é falha.
  assert.equal(await marcarDevolvidas([ACAO_A, ACAO_B, ACAO_C], QUARTA_MEIO_DIA), 2)
  assert.equal((await linhaDe(ACAO_C)).status, 'enviada')

  // Lista vazia, lixo e repetição não abrem conexão nem estragam nada.
  assert.equal(await marcarDevolvidas([], QUARTA_MEIO_DIA), 0)
  assert.equal(await marcarDevolvidas(['  ', ''], QUARTA_MEIO_DIA), 0)
})

// ─── A invariante do banco ────────────────────────────────────────────────────

test('o banco recusa uma SEGUNDA reserva viva para a mesma lead_actions', async () => {
  /* É a garantia que faz `WHERE lead_action_id = $1 AND status = 'reservada'` atingir
   * uma linha só. Sem ela, duas reservas vivas para a mesma ação significariam a mesma
   * pessoa contada duas vezes na cota e liquidada pela metade. */
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])

  await assert.rejects(
    () => registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)]),
    (erro: unknown) => {
      // Pelo NOME do índice, e não por "deu erro": é a diferença entre provar que a
      // invariante do banco recusou e provar que qualquer coisa deu errado.
      assert.match(textoDoErro(erro), /dispatch_claims_viva_unq/)
      return true
    },
  )
  assert.equal((await linhas()).length, 1)
})

test('o lote inteiro cai quando UMA reserva do lote é duplicada — nada pela metade', async () => {
  // Uma instrução só para o lote: ou entra tudo, ou não entra nada. Meio lote gravado
  // seria metade das reservas contável e metade invisível.
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])

  await assert.rejects(() => registrarReservas(TENANT, QUARTA_MEIO_DIA, [
    reserva(ACAO_B), reserva(ACAO_A), reserva(ACAO_C),
  ]))

  const todas = await linhas()
  assert.equal(todas.length, 1)
  assert.equal(todas[0].leadActionId, ACAO_A)
})

test('depois de devolvida (ou enviada), a MESMA ação pode ser reservada de novo', async () => {
  /* É por isso que o índice é PARCIAL e não um único simples: uma reserva devolvida
   * volta para a fila e SERÁ reservada outra vez. Um único simples em `lead_action_id`
   * recusaria a segunda e a campanha pararia para aquele lead para sempre. */
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])
  await marcarDevolvidas([ACAO_A], QUARTA_MEIO_DIA)

  const amanha = new Date('2026-09-24T15:00:00Z')
  assert.equal(await registrarReservas(TENANT, amanha, [reserva(ACAO_A)]), 1)

  // Duas LINHAS para a mesma ação, uma só viva — o histórico fica.
  const todas = await app.db.select().from(dispatchClaims)
    .where(eq(dispatchClaims.leadActionId, ACAO_A))
  assert.equal(todas.length, 2)
  assert.equal(todas.filter(l => l.status === 'reservada').length, 1)

  // E a terceira, com uma viva de pé, continua recusada.
  await assert.rejects(() => registrarReservas(TENANT, amanha, [reserva(ACAO_A)]))
})

// ─── Varredura de reserva parada ──────────────────────────────────────────────

test('a lista de paradas respeita o limiar, e a borda fica de fora', async () => {
  const velha = new Date('2026-09-23T14:00:00Z')   // 2h paradas
  const naBorda = new Date('2026-09-23T14:30:00Z') // exatamente no limiar
  const nova = new Date('2026-09-23T14:55:00Z')    // 5 min

  await registrarReservas(TENANT, velha, [reserva(ACAO_A)])
  await registrarReservas(TENANT, naBorda, [reserva(ACAO_B)])
  await registrarReservas(TENANT, nova, [reserva(ACAO_C)])

  const paradas = await listarReservasParadas(TENANT, naBorda)
  /* Só a velha. A da borda fica de fora porque a comparação é estritamente menor:
   * devolver cedo demais é o caminho para a mesma pessoa receber a mensagem duas vezes. */
  assert.equal(paradas.length, 1)
  assert.equal(paradas[0].acaoId, ACAO_A)
  assert.equal(paradas[0].tenantId, TENANT)
  assert.equal(paradas[0].fase, 'Template 1')
  assert.equal(paradas[0].idFase, 1)
  assert.deepEqual(paradas[0].reservadaEm, velha)
  assert.equal(paradas[0].balde, baldeDoAck(TENANT, velha))
})

test('a lista de paradas ignora o que já foi liquidado, e vem da mais velha para a mais nova', async () => {
  const cedo = new Date('2026-09-23T12:00:00Z')
  const meio = new Date('2026-09-23T13:00:00Z')
  const tarde = new Date('2026-09-23T14:00:00Z')

  await registrarReservas(TENANT, cedo, [reserva(ACAO_A)])
  await registrarReservas(TENANT, meio, [reserva(ACAO_B)])
  await registrarReservas(TENANT, tarde, [reserva(ACAO_C)])
  // Liquidadas somem da varredura: elas não estão paradas, estão resolvidas.
  await liquidarComoEnviada(ACAO_B, 'msg_ok', QUARTA_MEIO_DIA)

  const paradas = await listarReservasParadas(TENANT, QUARTA_MEIO_DIA)
  assert.deepEqual(paradas.map(p => p.acaoId), [ACAO_A, ACAO_C])

  // E é por tenant: a varredura de um não enxerga a reserva do outro.
  await registrarReservas(OUTRO_TENANT, cedo, [reserva('a0000000-0000-4000-8000-00000000000f')])
  assert.equal((await listarReservasParadas(TENANT, QUARTA_MEIO_DIA)).length, 2)
  assert.equal((await listarReservasParadas(OUTRO_TENANT, QUARTA_MEIO_DIA)).length, 1)
})

// ─── O balde: a fórmula que não pode divergir ─────────────────────────────────

test('o balde gravado é byte a byte o do ack', async () => {
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])

  const gravado = (await linhaDe(ACAO_A)).dayBucket
  assert.equal(gravado, baldeDoAck(TENANT, QUARTA_MEIO_DIA))
  // E a forma, escrita por extenso, para o teste falhar se o formato mudar de ideia.
  assert.equal(gravado, `${TENANT}:drip:20260923`)
})

test('o dia é o de SÃO PAULO, mesmo quando o UTC já virou', async () => {
  /* 2026-09-24T02:00Z é 2026-09-23 23:00 em São Paulo: para o UTC já é dia 24, para o
   * Brasil ainda é dia 23. O servidor roda em UTC, e é exatamente aqui que uma conta
   * ingênua colocaria a reserva no balde de AMANHÃ — zerando a cota de hoje às 21h e
   * liberando o limite inteiro de novo. */
  const noiteDeSp = new Date('2026-09-24T02:00:00Z')

  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_A)])
  await registrarReservas(TENANT, noiteDeSp, [reserva(ACAO_B)])

  const balde = `${TENANT}:drip:20260923`
  assert.equal(baldeDoAck(TENANT, noiteDeSp), balde, 'o ack também diz 23 — é a prova independente')
  assert.equal((await linhaDe(ACAO_B)).dayBucket, balde)

  // As duas caem no MESMO dia, então a cota as soma: 23h de Brasília ainda gasta a
  // permissão de quarta-feira.
  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 2)
  assert.equal(await contarConsumidasHoje(TENANT, noiteDeSp), 2)

  // E a virada de verdade (00:30 em São Paulo = 03:30Z) abre um balde novo.
  const madrugadaDeSp = new Date('2026-09-24T03:30:00Z')
  await registrarReservas(TENANT, madrugadaDeSp, [reserva(ACAO_C)])
  assert.equal((await linhaDe(ACAO_C)).dayBucket, `${TENANT}:drip:20260924`)
  assert.equal(await contarConsumidasHoje(TENANT, noiteDeSp), 2)
  assert.equal(await contarConsumidasHoje(TENANT, madrugadaDeSp), 1)
})

test('a contagem olha o balde, e não o carimbo — reserva de ontem não conta hoje', async () => {
  // Redundante com o teste acima só na aparência: aqui o que se prende é que a consulta
  // filtra por `day_bucket`, e não por um intervalo sobre `claimed_at`. Trocar um pelo
  // outro daria o mesmo número na maioria dos dias e o número errado nas bordas.
  await registrarReservas(TENANT, new Date('2026-09-22T15:00:00Z'), [reserva(ACAO_A)])
  await registrarReservas(TENANT, QUARTA_MEIO_DIA, [reserva(ACAO_B)])

  assert.equal(await contarConsumidasHoje(TENANT, QUARTA_MEIO_DIA), 1)

  const [viva] = await app.db.select().from(dispatchClaims).where(and(
    eq(dispatchClaims.dayBucket, `${TENANT}:drip:20260923`),
    eq(dispatchClaims.status, 'reservada'),
  ))
  assert.equal(viva.leadActionId, ACAO_B)
})
