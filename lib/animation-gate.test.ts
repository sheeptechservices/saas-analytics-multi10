/**
 * A regra de período existe duas vezes: em lib/animation-gate.ts, que o cliente
 * consulta, e dentro da string de app/animation-gate-script.ts, que roda no
 * <head> antes da primeira pintura e não pode importar nada.
 *
 * Duas cópias da mesma regra divergem em silêncio — ninguém percebe que a
 * fronteira das 18h mudou num arquivo e não no outro, porque as duas continuam
 * escrevendo um slot com cara de válido. Este teste roda as duas sobre as mesmas
 * datas e exige o mesmo resultado.
 *
 * O script é executado de verdade, com um DOM e um armazenamento falsos: comparar
 * o texto das duas implementações não provaria nada.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentSlot, periodOf, saoPauloClock, SESSION_KEY, SLOT_KEY } from '@/lib/animation-gate'
import { ANIMATION_GATE_SCRIPT } from '@/app/animation-gate-script'

// ─── Ambiente falso ───────────────────────────────────────────────────────────

function criarArmazenamento(bloqueado = false) {
  const dados = new Map<string, string>()
  return {
    dados,
    api: {
      getItem: (k: string) => (dados.has(k) ? dados.get(k)! : null),
      setItem: (k: string, v: string) => {
        if (bloqueado) throw new DOMException('bloqueado', 'SecurityError')
        dados.set(k, v)
      },
      removeItem: (k: string) => { dados.delete(k) },
    },
  }
}

interface Ambiente {
  reduzirMovimento?: boolean
  sessao?: ReturnType<typeof criarArmazenamento>
  local?: ReturnType<typeof criarArmazenamento>
}

/**
 * Executa a string do script com window e document injetados por parâmetro —
 * dentro da função, os nomes resolvem para os falsos, não para os globais.
 * `now` fixa o relógio só durante a execução.
 */
function rodarScript(now: Date, env: Ambiente = {}) {
  const sessao = env.sessao ?? criarArmazenamento()
  const local = env.local ?? criarArmazenamento()
  const root = { dataset: {} as Record<string, string> }

  const window = {
    sessionStorage: sessao.api,
    localStorage: local.api,
    matchMedia: () => ({ matches: env.reduzirMovimento === true }),
  }
  const document = { documentElement: root }

  const DateReal = globalThis.Date
  class DateFixa extends DateReal {
    // O script chama new Date() (sem argumento) e new Date(Date.UTC(...)) (um só).
    constructor(...args: [] | [number | string | Date]) {
      if (args.length === 0) super(now.getTime())
      else super(args[0])
    }
  }
  globalThis.Date = DateFixa as DateConstructor
  try {
    new Function('window', 'document', ANIMATION_GATE_SCRIPT)(window, document)
  } finally {
    globalThis.Date = DateReal
  }

  return { animate: root.dataset.animate, sessao, local }
}

/** O slot que o script gravou — é o que dá para observar da decisão dele. */
function slotDoScript(now: Date): string | null {
  const r = rodarScript(now)
  return r.local.api.getItem(SLOT_KEY)
}

// ─── Fronteiras ───────────────────────────────────────────────────────────────

// Horários em São Paulo (UTC-3 o ano todo desde 2019), escritos em UTC para não
// depender do fuso da máquina que roda o teste.
const FRONTEIRAS: Array<{ nome: string; utc: string; slot: string }> = [
  { nome: '04:59 — último minuto da noite anterior', utc: '2026-09-12T07:59:00Z', slot: '2026-09-11:noite' },
  { nome: '05:00 — começa a manhã',                  utc: '2026-09-12T08:00:00Z', slot: '2026-09-12:manha' },
  { nome: '11:59 — último minuto da manhã',          utc: '2026-09-12T14:59:00Z', slot: '2026-09-12:manha' },
  { nome: '12:00 — começa a tarde',                  utc: '2026-09-12T15:00:00Z', slot: '2026-09-12:tarde' },
  { nome: '17:59 — último minuto da tarde',          utc: '2026-09-12T20:59:00Z', slot: '2026-09-12:tarde' },
  { nome: '18:00 — começa a noite',                  utc: '2026-09-12T21:00:00Z', slot: '2026-09-12:noite' },
  { nome: '00:30 — madrugada pertence ao dia anterior', utc: '2026-09-12T03:30:00Z', slot: '2026-09-11:noite' },
]

for (const caso of FRONTEIRAS) {
  test(`fronteira ${caso.nome}: as duas implementações concordam`, () => {
    const agora = new Date(caso.utc)
    assert.equal(currentSlot(agora), caso.slot, 'módulo')
    assert.equal(slotDoScript(agora), caso.slot, 'script pré-pintura')
  })
}

test('a virada de mês recua para o mês certo nas duas', () => {
  const agora = new Date('2026-10-01T03:30:00Z') // 00:30 de 01/10 em São Paulo
  assert.equal(currentSlot(agora), '2026-09-30:noite')
  assert.equal(slotDoScript(agora), '2026-09-30:noite')
})

test('a virada de ano recua para o ano certo nas duas', () => {
  const agora = new Date('2027-01-01T03:30:00Z') // 00:30 de 01/01 em São Paulo
  assert.equal(currentSlot(agora), '2026-12-31:noite')
  assert.equal(slotDoScript(agora), '2026-12-31:noite')
})

test('o período não depende do fuso da máquina', () => {
  // 23:00 UTC de 12/09 é 20:00 em São Paulo — noite, mesmo dia.
  const agora = new Date('2026-09-12T23:00:00Z')
  assert.equal(saoPauloClock(agora).hour, 20)
  assert.equal(currentSlot(agora), '2026-09-12:noite')
  assert.equal(slotDoScript(agora), '2026-09-12:noite')
})

test('periodOf cobre as 24 horas sem buraco', () => {
  for (let h = 0; h < 24; h++) {
    const p = periodOf(h)
    const esperado = h >= 5 && h < 12 ? 'manha' : h >= 12 && h < 18 ? 'tarde' : 'noite'
    assert.equal(p, esperado, `hora ${h}`)
  }
})

// ─── Comportamento do gate ────────────────────────────────────────────────────

const AGORA = new Date('2026-09-12T15:00:00Z') // 12:00 em São Paulo, slot da tarde

test('primeira visita da sessão anima e consome o slot', () => {
  const r = rodarScript(AGORA)
  assert.equal(r.animate, 'on')
  assert.equal(r.sessao.api.getItem(SESSION_KEY), '1')
  assert.equal(r.local.api.getItem(SLOT_KEY), '2026-09-12:tarde')
})

test('segunda carga na mesma sessão não anima', () => {
  const sessao = criarArmazenamento()
  const local = criarArmazenamento()
  assert.equal(rodarScript(AGORA, { sessao, local }).animate, 'on')
  assert.equal(rodarScript(AGORA, { sessao, local }).animate, 'off')
})

test('sessão nova no mesmo período não anima', () => {
  const local = criarArmazenamento()
  rodarScript(AGORA, { sessao: criarArmazenamento(), local })
  const segunda = rodarScript(AGORA, { sessao: criarArmazenamento(), local })
  assert.equal(segunda.animate, 'off')
})

test('sessão nova no período seguinte anima de novo', () => {
  const local = criarArmazenamento()
  rodarScript(AGORA, { sessao: criarArmazenamento(), local })
  const noite = new Date('2026-09-12T21:00:00Z') // 18:00 em São Paulo
  const segunda = rodarScript(noite, { sessao: criarArmazenamento(), local })
  assert.equal(segunda.animate, 'on')
  assert.equal(local.api.getItem(SLOT_KEY), '2026-09-12:noite')
})

test('prefers-reduced-motion não anima e não consome o slot', () => {
  const local = criarArmazenamento()
  const r = rodarScript(AGORA, { local, reduzirMovimento: true })
  assert.equal(r.animate, 'off')
  assert.equal(local.api.getItem(SLOT_KEY), null)
})

test('armazenamento bloqueado não anima e não quebra', () => {
  const r = rodarScript(AGORA, { sessao: criarArmazenamento(true), local: criarArmazenamento(true) })
  assert.equal(r.animate, 'off')
})

test('o atributo sai como off antes de qualquer decisão', () => {
  // Mesmo no caminho que anima, o valor inicial escrito é 'off': o HTML do
  // servidor está no estado final, e só vira 'on' se o gate liberar.
  const r = rodarScript(AGORA, { reduzirMovimento: true })
  assert.equal(r.animate, 'off')
})
