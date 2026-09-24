import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsonSemNulos } from '@/lib/json-seguro'

/* São dois escapes que o `payload::jsonb` recusa, e os dois derrubam a varredura
 * inteira (ver lib/json-seguro.ts): NUL (22P05) e surrogate sem par (22P02). O
 * efeito no Postgres está provado em lib/db/consultas.test.ts; aqui prendemos a
 * serialização em si. */

// ─── NUL ─────────────────────────────────────────────────────────────────────

test('some com o NUL de dentro das strings', () => {
  assert.equal(jsonSemNulos({ a: 'antes\u0000depois' }), '{"a":"antesdepois"}')
  assert.ok(!jsonSemNulos({ a: '\u0000' }).includes('\\u0000'))
})

test('alcança string aninhada em objeto e em vetor', () => {
  const texto = jsonSemNulos({ n: { m: ['x\u0000y', { z: 'a\u0000b' }] } })
  assert.ok(!texto.includes('\\u0000'))
  assert.deepEqual(JSON.parse(texto), { n: { m: ['xy', { z: 'ab' }] } })
})

test('limpa também a CHAVE, que o replacer sozinho não alcançaria', () => {
  const texto = jsonSemNulos({ 'cha\u0000ve': 1 })
  assert.ok(!texto.includes('\\u0000'))
  assert.deepEqual(JSON.parse(texto), { chave: 1 })
})

/* A razão de limpar os VALORES em vez de dar um replace no texto já serializado:
 * uma barra invertida literal seguida de "u0000" termina nos mesmos seis
 * caracteres. Um `.replace(/\\u0000/g, '')` sobre o texto comeria parte dela e
 * produziria JSON inválido. Aqui a barra tem de sobreviver inteira. */
test('barra invertida literal seguida de u0000 continua intacta', () => {
  const original = { a: '\\u0000' }
  const texto = jsonSemNulos(original)
  assert.deepEqual(JSON.parse(texto), original, 'o valor não pode ser mutilado')
  assert.equal(JSON.parse(texto).a, '\\u0000')
})

// ─── Surrogate sem par ───────────────────────────────────────────────────────

/* Premissa: o JSON.stringify é "well-formed" desde o ES2019 e emite o surrogate
 * solto como escape. É esse escape que o jsonb recusa. */
test('premissa: JSON.stringify emite o surrogate solto como escape', () => {
  assert.equal(JSON.stringify({ a: '\uD83D' }), '{"a":"\\ud83d"}')
  assert.equal(JSON.stringify({ a: '\uDE00' }), '{"a":"\\ude00"}')
})

test('surrogate ALTO sem par some', () => {
  const texto = jsonSemNulos({ a: 'oi \uD83D' })
  assert.ok(!/\\ud[89ab][0-9a-f]{2}/i.test(texto), texto)
  assert.equal(JSON.parse(texto).a, 'oi ')
})

test('surrogate BAIXO sem par some', () => {
  const texto = jsonSemNulos({ a: '\uDE00 tchau' })
  assert.ok(!/\\ud[c-f][0-9a-f]{2}/i.test(texto), texto)
  assert.equal(JSON.parse(texto).a, ' tchau')
})

test('surrogate solto em chave também some', () => {
  const texto = jsonSemNulos({ ['ch\uD800ave']: 1 })
  assert.deepEqual(JSON.parse(texto), { chave: 1 })
})

/* O contraponto que impede a limpeza de virar uma marretada: emoji de verdade é
 * um PAR de surrogates e tem de passar inteiro. */
test('emoji completo sobrevive — par válido não é lixo', () => {
  const comEmoji = { a: 'tudo certo \u{1F600}', b: '\u{1F1E7}\u{1F1F7} Brasil' }
  assert.equal(jsonSemNulos(comEmoji), JSON.stringify(comEmoji))
  assert.deepEqual(JSON.parse(jsonSemNulos(comEmoji)), comEmoji)
})

test('emoji ao lado de um surrogate solto: só o solto some', () => {
  const texto = jsonSemNulos({ a: '\u{1F600}\uD83D\u{1F600}' })
  assert.equal(JSON.parse(texto).a, '\u{1F600}\u{1F600}')
})

// ─── Geral ───────────────────────────────────────────────────────────────────

test('sem NUL e sem surrogate solto, o resultado é idêntico ao do JSON.stringify', () => {
  const v = { a: 1, b: 'texto', c: [true, null, 2.5], d: { e: 'ç ã é' }, f: '\u{1F680}' }
  assert.equal(jsonSemNulos(v), JSON.stringify(v))
})

test('tipos de borda continuam se comportando como no JSON.stringify', () => {
  assert.equal(jsonSemNulos({}), '{}')
  assert.equal(jsonSemNulos([]), '[]')
  assert.equal(jsonSemNulos(null), 'null')
  assert.equal(jsonSemNulos({ d: new Date('2026-05-01T00:00:00Z') }), '{"d":"2026-05-01T00:00:00.000Z"}')
})

test('os dois lixos juntos, no mesmo valor', () => {
  const texto = jsonSemNulos({ a: 'x\u0000y\uD83Dz' })
  assert.equal(JSON.parse(texto).a, 'xyz')
})
