import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDensity, defaultDensityForRole, parseDensity, DENSITY_COOKIE } from '@/lib/density'

test('padrão por papel: usuário do cliente confortável, master e anônimo compactos', () => {
  assert.equal(defaultDensityForRole('admin'), 'comfortable')
  // Conta única: linha legada é admin na prática, e ganha a mesma densidade.
  assert.equal(defaultDensityForRole('manager'), 'comfortable')
  assert.equal(defaultDensityForRole('user'), 'comfortable')
  assert.equal(defaultDensityForRole('master'), 'compact')
  assert.equal(defaultDensityForRole(null), 'compact')
  assert.equal(defaultDensityForRole(''), 'compact')
})

test('o cookie vence o padrão do papel', () => {
  assert.equal(resolveDensity('compact', 'admin'), 'compact')
  assert.equal(resolveDensity('comfortable', 'master'), 'comfortable')
})

test('valor estranho no cookie cai no padrão em vez de virar atributo', () => {
  assert.equal(resolveDensity('gigante', 'admin'), 'comfortable')
  assert.equal(resolveDensity('', 'master'), 'compact')
  assert.equal(resolveDensity(undefined, 'manager'), 'comfortable')
  assert.equal(parseDensity('compacto'), null) // o valor antigo, em português, não vale mais
})

test('os valores são a chave que o seletor do CSS espera', () => {
  // :root[data-density="compact"] está em app/globals.css. Português aqui
  // quebraria o seletor em silêncio — a tela ficaria confortável para todo mundo.
  assert.equal(parseDensity('compact'), 'compact')
  assert.equal(parseDensity('comfortable'), 'comfortable')
  assert.equal(DENSITY_COOKIE, 'densidade')
})
