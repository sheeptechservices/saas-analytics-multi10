import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  timeAgo,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatShortDateTime,
  formatDateTimeLong,
  orEmptyLabel,
  isEmptyValue,
  TRACO_VAZIO,
} from '@/lib/format'

// O espaço do pt-BR em moeda e percentual é NBSP, não espaço comum — comparar
// com espaço de teclado faz o teste falhar por um caractere invisível.
const nbsp = (s: string) => s.replace(/ /g, ' ')

test('número em pt-BR: ponto de milhar e vírgula decimal', () => {
  assert.equal(formatNumber(1284), '1.284')
  assert.equal(formatNumber(55988), '55.988')
  assert.equal(formatNumber(0), '0')
  assert.equal(formatNumber(1234.567, 2), '1.234,57')
})

test('número ausente ou inválido vira traço, e zero não', () => {
  assert.equal(formatNumber(null), TRACO_VAZIO)
  assert.equal(formatNumber(undefined), TRACO_VAZIO)
  assert.equal(formatNumber(NaN), TRACO_VAZIO)
  assert.equal(formatNumber(Infinity), TRACO_VAZIO)
  assert.equal(formatNumber(0), '0')
})

test('dinheiro ausente não vira R$ 0,00', () => {
  assert.equal(nbsp(formatCurrency(1234.5)), 'R$ 1.234,50')
  assert.equal(formatCurrency(null), TRACO_VAZIO)
  assert.equal(nbsp(formatCurrency(0)), 'R$ 0,00')
})

test('percentual recebe a escala de exibição, não a fração', () => {
  assert.equal(formatPercent(42.5), '42,5%')
  assert.equal(formatPercent(100, 0), '100%')
  assert.equal(formatPercent(null), TRACO_VAZIO)
})

test('data curta sai como 31/08 09:12, no fuso de São Paulo', () => {
  // 2026-08-31T12:12:00Z = 09:12 em São Paulo (UTC-3).
  assert.equal(formatShortDateTime('2026-08-31T12:12:00Z'), '31/08 09:12')
  assert.equal(formatDateTimeLong('2026-08-31T12:12:00Z'), '31/08/2026 09:12')
})

test('data é formatada no fuso do Brasil mesmo virando o dia em UTC', () => {
  // 01/09 00:30 UTC ainda é 31/08 21:30 em São Paulo.
  assert.equal(formatShortDateTime('2026-09-01T00:30:00Z'), '31/08 21:30')
})

test('data ausente ou inválida vira traço, nunca Invalid Date', () => {
  assert.equal(formatShortDateTime(null), TRACO_VAZIO)
  assert.equal(formatShortDateTime(''), TRACO_VAZIO)
  assert.equal(formatShortDateTime('não é data'), TRACO_VAZIO)
  assert.equal(formatDateTimeLong(undefined), TRACO_VAZIO)
})

test('tempo relativo, assinatura preservada', () => {
  const agora = Date.now()
  assert.equal(timeAgo(null), TRACO_VAZIO)
  assert.equal(timeAgo(agora - 30_000), 'agora')
  assert.equal(timeAgo(agora - 12 * 60_000), '12min')
  assert.equal(timeAgo(agora - 3 * 3_600_000), '3h')
  assert.equal(timeAgo(agora - 5 * 86_400_000), '5d')
})

test('campo vazio: rótulo nomeia o que falta', () => {
  assert.equal(orEmptyLabel(null, 'empresa'), 'Sem empresa')
  assert.equal(orEmptyLabel('   ', 'origem'), 'Sem origem')
  assert.equal(orEmptyLabel(undefined, 'interacao'), 'Sem interação')
  assert.equal(orEmptyLabel('', 'nome'), 'Sem nome')
  assert.equal(orEmptyLabel(null, 'negocio'), 'Sem negócio')
})

test('valor preenchido volta aparado', () => {
  assert.equal(orEmptyLabel('  Orteconte  ', 'empresa'), 'Orteconte')
  assert.equal(isEmptyValue('x'), false)
  assert.equal(isEmptyValue('  '), true)
  assert.equal(isEmptyValue(null), true)
  assert.equal(isEmptyValue(0), false)
})
