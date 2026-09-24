import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sql } from 'drizzle-orm'
import type { Client } from '@libsql/client'
import { tenants } from '@/lib/db/schema'

/* O deploy na Railway morreu porque importar @/lib/db abria o banco na hora.
 * Estes testes prendem o contrário: importar não cria nada, e a falta da
 * variável em produção falha alto no primeiro uso — nunca na importação.
 *
 * A ordem dos testes importa e é proposital: enquanto não houver URL, nenhuma
 * tentativa pode deixar cliente guardado no globalThis. */

const PREFIXO = 'lazy-db-test-'
let dir: string

type EscopoDb = typeof globalThis & { __tursoClient?: Client; __tursoDb?: unknown }
const escopo = globalThis as EscopoDb

let mod: typeof import('@/lib/db')

// NODE_ENV chega tipado como somente-leitura pelos tipos do Next; o teste precisa
// trocá-lo, e este alias faz isso sem recorrer a `any`.
const env = process.env as Record<string, string | undefined>
const nodeEnvOriginal = process.env.NODE_ENV

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
  delete process.env.TURSO_DATABASE_URL
  delete process.env.TURSO_AUTH_TOKEN
})

after(() => {
  env.NODE_ENV = nodeEnvOriginal
  try { escopo.__tursoClient?.close() } catch {}
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
})

test('importar sem TURSO_DATABASE_URL não lança e não cria cliente nenhum', async () => {
  assert.equal(process.env.TURSO_DATABASE_URL, undefined)
  mod = await import('@/lib/db')
  assert.ok(mod.db, 'o módulo exporta db')
  assert.ok(mod.client, 'o módulo exporta client')
  assert.equal(escopo.__tursoClient, undefined, 'nada foi construído na importação')
  assert.equal(escopo.__tursoDb, undefined)
})

test('em produção e sem a variável, o primeiro uso falha alto e nomeia a variável', async () => {
  env.NODE_ENV = 'production'
  await assert.rejects(
    async () => mod.db.select().from(tenants),
    (e: unknown) => {
      assert.match((e as Error).message, /TURSO_DATABASE_URL/)
      assert.match((e as Error).message, /produção/)
      return true
    },
  )
  // A tentativa falha não pode deixar resto guardado: o ambiente pode ser
  // corrigido antes da próxima requisição.
  assert.equal(escopo.__tursoClient, undefined)
  assert.equal(escopo.__tursoDb, undefined)
})

test('fora de produção a URL file: continua valendo — e é aí que o cliente nasce', async () => {
  env.NODE_ENV = nodeEnvOriginal
  process.env.TURSO_DATABASE_URL = pathToFileURL(join(dir, 'lazy.db')).href

  const r = await mod.db.run(sql`select 1 as um`)
  assert.equal(r.rows[0].um, 1)
  assert.ok(escopo.__tursoClient, 'o cliente só apareceu depois da primeira consulta')
})

test('o cache do globalThis devolve sempre a mesma instância', async () => {
  const primeiro = escopo.__tursoClient
  await mod.db.run(sql`select 2`)
  await mod.client.execute('select 3')
  assert.equal(escopo.__tursoClient, primeiro, 'nenhuma consulta posterior recriou o cliente')
})

test('a fachada repassa método com o `this` certo (campo privado do libsql)', async () => {
  // client.execute lê campos privados (#url, #authToken); se o bind não
  // acontecesse, isto lançaria em vez de responder.
  const rs = await mod.client.execute('select 42 as resposta')
  assert.equal(rs.rows[0].resposta, 42)
})
