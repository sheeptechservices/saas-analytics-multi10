import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timingSafeEqualStrings } from '@/lib/timing-safe'

test('strings iguais passam', () => {
  assert.equal(timingSafeEqualStrings('segredo-do-n8n', 'segredo-do-n8n'), true)
  assert.equal(timingSafeEqualStrings('ação-çü-🙂', 'ação-çü-🙂'), true)
})

test('strings diferentes do mesmo tamanho não passam', () => {
  assert.equal(timingSafeEqualStrings('abcdefgh', 'abcdefgi'), false)
  assert.equal(timingSafeEqualStrings('abcdefgh', 'zbcdefgh'), false)
})

// O motivo do helper existir: timingSafeEqual lança quando os buffers têm
// tamanhos diferentes — aqui isso vira `false`, não exceção.
test('tamanhos diferentes devolvem false sem lançar', () => {
  assert.doesNotThrow(() => timingSafeEqualStrings('curto', 'bem mais comprido'))
  assert.equal(timingSafeEqualStrings('curto', 'bem mais comprido'), false)
  assert.equal(timingSafeEqualStrings('', 'abc'), false)
  assert.equal(timingSafeEqualStrings('abc', ''), false)
  // Mesmo número de caracteres, número de BYTES diferente: não pode lançar.
  assert.doesNotThrow(() => timingSafeEqualStrings('aaa', 'ção'))
  assert.equal(timingSafeEqualStrings('aaa', 'ção'), false)
})
