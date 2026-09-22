import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient, type Client } from '@libsql/client'
import { acquireJobLock, releaseJobLock } from '@/lib/cron-lock'

// Banco de arquivo descartável — nunca o do .env.local.
const PREFIXO = 'cron-lock-test-'
let dir: string
let client: Client

// No Windows o libsql às vezes só solta o arquivo quando o processo sai, e aí o
// diretório fica para trás. Quem sobrou de execuções anteriores sai aqui.
function limparSobras() {
  const limite = Date.now() - 10 * 60_000
  for (const nome of readdirSync(tmpdir())) {
    if (!nome.startsWith(PREFIXO)) continue
    const caminho = join(tmpdir(), nome)
    try { if (statSync(caminho).mtimeMs < limite) rmSync(caminho, { recursive: true, force: true }) } catch {}
  }
}

before(() => {
  limparSobras()
  dir = mkdtempSync(join(tmpdir(), PREFIXO))
  client = createClient({ url: pathToFileURL(join(dir, 'locks.db')).href })
})

after(() => {
  client.close()
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
})

const MIN = 60_000

test('cria a tabela sozinho, num banco sem migração nenhuma', async () => {
  const owner = await acquireJobLock(client, 'tabela', { ttlMs: MIN })
  assert.ok(owner)
  const rs = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_locks'")
  assert.equal(rs.rows.length, 1)
})

test('tomar → segundo acquire falha → soltar → tomar de novo', async () => {
  const t0 = 1_000_000
  const primeiro = await acquireJobLock(client, 'ciclo', { ttlMs: 30 * MIN, now: t0 })
  assert.ok(primeiro, 'a primeira execução pega a trava')

  const segundo = await acquireJobLock(client, 'ciclo', { ttlMs: 30 * MIN, now: t0 + MIN })
  assert.equal(segundo, null, 'com a trava válida, a segunda execução não entra')

  await releaseJobLock(client, 'ciclo', primeiro)
  const terceiro = await acquireJobLock(client, 'ciclo', { ttlMs: 30 * MIN, now: t0 + 2 * MIN })
  assert.ok(terceiro, 'depois do release, a trava fica livre')
  assert.notEqual(terceiro, primeiro)
})

test('trava vencida é assumida — e o release atrasado do dono antigo não a solta', async () => {
  const t0 = 2_000_000
  const antigo = await acquireJobLock(client, 'vencida', { ttlMs: 30 * MIN, now: t0 })
  assert.ok(antigo)

  assert.equal(await acquireJobLock(client, 'vencida', { ttlMs: 30 * MIN, now: t0 + 29 * MIN }), null)

  const novo = await acquireJobLock(client, 'vencida', { ttlMs: 30 * MIN, now: t0 + 31 * MIN })
  assert.ok(novo, 'passado o TTL, a próxima execução assume')

  await releaseJobLock(client, 'vencida', antigo)
  assert.equal(
    await acquireJobLock(client, 'vencida', { ttlMs: 30 * MIN, now: t0 + 32 * MIN }),
    null,
    'o release de quem já perdeu a trava não mexe na do novo dono',
  )
})

test('travas com nomes diferentes não se bloqueiam', async () => {
  assert.ok(await acquireJobLock(client, 'job-a', { ttlMs: MIN }))
  assert.ok(await acquireJobLock(client, 'job-b', { ttlMs: MIN }))
})

test('duas chamadas simultâneas: só uma sai com a trava', async () => {
  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => acquireJobLock(client, 'corrida', { ttlMs: MIN })),
  )
  assert.equal(resultados.filter(Boolean).length, 1)
})

test('o label entra no dono gravado, para diagnóstico', async () => {
  const owner = await acquireJobLock(client, 'rotulo', { ttlMs: MIN, label: 'railway' })
  assert.match(owner ?? '', /^railway:/)
  const rs = await client.execute({ sql: 'SELECT owner FROM job_locks WHERE name = ?', args: ['rotulo'] })
  assert.equal(rs.rows[0].owner, owner)
})
