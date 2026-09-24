import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import { bancoDeTeste } from '@/test-support/pglite'
import { acquireJobLock, releaseJobLock } from '@/lib/cron-lock'

/* Postgres de verdade (PGlite, em memória) e SEM migração nenhuma aplicada: é
 * exatamente o estado em que o cron-lock precisa funcionar, já que a tabela
 * job_locks se cria sozinha em tempo de execução. Nada toca banco real. */

let pg: PGlite
let fechar: () => Promise<void>

before(async () => {
  ;({ pg, fechar } = await bancoDeTeste({ comSchema: false }))
})

after(async () => { await fechar() })

const MIN = 60_000

test('cria a tabela sozinho, num banco sem migração nenhuma', async () => {
  const owner = await acquireJobLock(pg, 'tabela', { ttlMs: MIN })
  assert.ok(owner)
  // Equivalente Postgres do "SELECT name FROM sqlite_master WHERE type='table'".
  const rs = await pg.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'job_locks'`,
  )
  assert.equal(rs.rows.length, 1)
})

test('tomar → segundo acquire falha → soltar → tomar de novo', async () => {
  const t0 = 1_000_000
  const primeiro = await acquireJobLock(pg, 'ciclo', { ttlMs: 30 * MIN, now: t0 })
  assert.ok(primeiro, 'a primeira execução pega a trava')

  const segundo = await acquireJobLock(pg, 'ciclo', { ttlMs: 30 * MIN, now: t0 + MIN })
  assert.equal(segundo, null, 'com a trava válida, a segunda execução não entra')

  await releaseJobLock(pg, 'ciclo', primeiro)
  const terceiro = await acquireJobLock(pg, 'ciclo', { ttlMs: 30 * MIN, now: t0 + 2 * MIN })
  assert.ok(terceiro, 'depois do release, a trava fica livre')
  assert.notEqual(terceiro, primeiro)
})

test('trava vencida é assumida — e o release atrasado do dono antigo não a solta', async () => {
  const t0 = 2_000_000
  const antigo = await acquireJobLock(pg, 'vencida', { ttlMs: 30 * MIN, now: t0 })
  assert.ok(antigo)

  assert.equal(await acquireJobLock(pg, 'vencida', { ttlMs: 30 * MIN, now: t0 + 29 * MIN }), null)

  const novo = await acquireJobLock(pg, 'vencida', { ttlMs: 30 * MIN, now: t0 + 31 * MIN })
  assert.ok(novo, 'passado o TTL, a próxima execução assume')

  await releaseJobLock(pg, 'vencida', antigo)
  assert.equal(
    await acquireJobLock(pg, 'vencida', { ttlMs: 30 * MIN, now: t0 + 32 * MIN }),
    null,
    'o release de quem já perdeu a trava não mexe na do novo dono',
  )
})

test('travas com nomes diferentes não se bloqueiam', async () => {
  assert.ok(await acquireJobLock(pg, 'job-a', { ttlMs: MIN }))
  assert.ok(await acquireJobLock(pg, 'job-b', { ttlMs: MIN }))
})

test('duas chamadas simultâneas: só uma sai com a trava', async () => {
  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => acquireJobLock(pg, 'corrida', { ttlMs: MIN })),
  )
  assert.equal(resultados.filter(Boolean).length, 1)
})

test('o label entra no dono gravado, para diagnóstico', async () => {
  const owner = await acquireJobLock(pg, 'rotulo', { ttlMs: MIN, label: 'railway' })
  assert.match(owner ?? '', /^railway:/)
  const rs = await pg.query<{ owner: string }>(
    'SELECT owner FROM job_locks WHERE name = $1', ['rotulo'],
  )
  assert.equal(rs.rows[0].owner, owner)
})

/* Novo na migração: locked_until guarda epoch em MILISSEGUNDOS. No SQLite,
 * INTEGER é de 64 bits e `integer` bastava; no Postgres, `integer` é int4 e
 * estoura em 2.147.483.647 — Date.now() vale ~1,77e12. Se o DDL do cron-lock
 * usasse `integer`, este teste falharia com "integer out of range". */
test('o prazo em epoch ms cabe na coluna (bigint, não integer)', async () => {
  const agora = Date.now()
  assert.ok(agora > 2_147_483_647, 'a premissa: Date.now() não cabe num int4')

  const owner = await acquireJobLock(pg, 'epoch-ms', { ttlMs: 30 * MIN, now: agora })
  assert.ok(owner)

  const rs = await pg.query<{ locked_until: string | number }>(
    'SELECT locked_until FROM job_locks WHERE name = $1', ['epoch-ms'],
  )
  assert.equal(Number(rs.rows[0].locked_until), agora + 30 * MIN, 'o valor volta inteiro, sem truncar')
})

/* A trava só vale se a linha antiga for reavaliada na versão mais nova dela.
 * Aqui: A toma, B tenta com o MESMO relógio de A (prazo ainda válido) e leva
 * null; só depois do prazo é que alguém entra. */
test('o ON CONFLICT ... DO UPDATE ... WHERE enxerga o prazo já renovado', async () => {
  const t0 = 5_000_000
  assert.ok(await acquireJobLock(pg, 'conflito', { ttlMs: 10 * MIN, now: t0 }))
  assert.equal(await acquireJobLock(pg, 'conflito', { ttlMs: 10 * MIN, now: t0 }), null)
  // A condição é `locked_until < now`, igualzinha à do SQLite: no instante exato
  // do vencimento a trava ainda é do dono; livre a partir do milissegundo seguinte.
  assert.equal(await acquireJobLock(pg, 'conflito', { ttlMs: 10 * MIN, now: t0 + 10 * MIN }), null)
  assert.ok(await acquireJobLock(pg, 'conflito', { ttlMs: 10 * MIN, now: t0 + 10 * MIN + 1 }))
})
