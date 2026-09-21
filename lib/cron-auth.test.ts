import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isCronAuthorized } from '@/lib/cron-auth'

const SEGREDO = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const original = process.env.CRON_SECRET

const pedido = (authorization?: string) =>
  new Request('https://app.exemplo/api/cron/all', {
    headers: authorization === undefined ? {} : { authorization },
  })

beforeEach(() => { process.env.CRON_SECRET = SEGREDO })
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = original
})

test('segredo certo passa', () => {
  assert.equal(isCronAuthorized(pedido(`Bearer ${SEGREDO}`)), true)
})

test('segredo errado, ausente ou sem o prefixo Bearer não passa', () => {
  assert.equal(isCronAuthorized(pedido(`Bearer ${SEGREDO.slice(0, -1)}x`)), false)
  assert.equal(isCronAuthorized(pedido(`Bearer ${SEGREDO}0`)), false)
  assert.equal(isCronAuthorized(pedido(SEGREDO)), false)
  assert.equal(isCronAuthorized(pedido('')), false)
  assert.equal(isCronAuthorized(pedido()), false)
})

// O defeito que motivou o helper: com CRON_SECRET ausente, a comparação antiga
// esperava a string "Bearer undefined" — e aceitava quem mandasse exatamente isso.
test('sem CRON_SECRET no ambiente, nada passa — nem "Bearer undefined"', (t) => {
  t.mock.method(console, 'error', () => {})
  delete process.env.CRON_SECRET
  assert.equal(isCronAuthorized(pedido('Bearer undefined')), false)
  assert.equal(isCronAuthorized(pedido('Bearer ')), false)
  assert.equal(isCronAuthorized(pedido()), false)

  process.env.CRON_SECRET = ''
  assert.equal(isCronAuthorized(pedido('Bearer ')), false)
})
