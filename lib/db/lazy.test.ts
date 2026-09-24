import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import { tenants } from '@/lib/db/schema'

/* O deploy na Railway morreu porque importar @/lib/db abria o banco na hora.
 * Estes testes prendem o contrário: importar não cria nada, e a falta da
 * variável falha alto no primeiro uso — nunca na importação.
 *
 * A propriedade continua valendo com o Postgres, e continua importando pelo
 * mesmo motivo: o `next build` importa cada rota no "collecting page data", sem
 * variável de ambiente nenhuma, e nada pode estourar ali.
 *
 * Nenhum teste deste arquivo abre socket. O `new Pool()` do `pg` é preguiçoso
 * por conta própria — não conecta até a primeira consulta —, então dá para
 * construí-lo contra um endereço inventado e inspecionar tudo sem I/O. A URL
 * usada não existe e nunca é consultada.
 *
 * A ordem dos testes importa e é proposital: enquanto não houver URL, nenhuma
 * tentativa pode deixar pool guardado no globalThis. */

type EscopoDb = typeof globalThis & { __pgPool?: Pool; __pgDb?: unknown }

/* Lidos por funcao, e nao pela propriedade direto: o TypeScript estreita o tipo
 * a cada assert deste arquivo (um `=== undefined` deixa o tipo em `undefined`, e
 * o `assert.ok` seguinte chegaria em `never`). A funcao devolve sempre
 * `Pool | undefined`. */
const poolGuardado = (): Pool | undefined => (globalThis as EscopoDb).__pgPool
const dbGuardado = (): unknown => (globalThis as EscopoDb).__pgDb

let mod: typeof import('@/lib/db')

// URL sintática válida, host que não existe. Serve só para o Pool nascer; como
// nenhum teste daqui consulta, nada é resolvido nem conectado.
const URL_FALSA = 'postgres://usuario:senha@banco.invalido.interno:5432/app'

// NODE_ENV chega tipado como somente-leitura pelos tipos do Next; o teste precisa
// trocá-lo, e este alias faz isso sem recorrer a `any`.
const env = process.env as Record<string, string | undefined>
const nodeEnvOriginal = process.env.NODE_ENV
const urlOriginal = process.env.DATABASE_URL

before(() => {
  delete process.env.DATABASE_URL
  delete process.env.PGSSLMODE
})

after(async () => {
  env.NODE_ENV = nodeEnvOriginal
  if (urlOriginal === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = urlOriginal
  try { await poolGuardado()?.end() } catch {}
})

test('importar sem DATABASE_URL não lança e não cria pool nenhum', async () => {
  assert.equal(process.env.DATABASE_URL, undefined)
  mod = await import('@/lib/db')
  assert.ok(mod.db, 'o módulo exporta db')
  assert.ok(mod.pool, 'o módulo exporta pool')
  assert.equal(poolGuardado(), undefined, 'nada foi construído na importação')
  assert.equal(dbGuardado(), undefined)
})

test('em produção e sem a variável, o primeiro uso falha alto e nomeia a variável', async () => {
  env.NODE_ENV = 'production'
  await assert.rejects(
    async () => mod.db.select().from(tenants),
    (e: unknown) => {
      assert.match((e as Error).message, /DATABASE_URL/)
      assert.match((e as Error).message, /produção/)
      return true
    },
  )
  // A tentativa falha não pode deixar resto guardado: o ambiente pode ser
  // corrigido antes da próxima requisição.
  assert.equal(poolGuardado(), undefined)
  assert.equal(dbGuardado(), undefined)
})

/* Mudança em relação ao Turso, e é uma decisão: não existe mais fallback de
 * desenvolvimento. Antes caía num arquivo SQLite local; Postgres não tem
 * equivalente honesto nesta máquina, e inventar 'postgres://localhost:5432'
 * trocaria um erro claro por um ECONNREFUSED confuso. Então falta de variável é
 * erro em qualquer ambiente — muda só o conselho. */
test('fora de produção também falha, com conselho diferente e sem inventar padrão', async () => {
  env.NODE_ENV = nodeEnvOriginal
  await assert.rejects(
    async () => mod.db.select().from(tenants),
    (e: unknown) => {
      const msg = (e as Error).message
      assert.match(msg, /DATABASE_URL/)
      assert.doesNotMatch(msg, /produção/, 'fora de produção o texto é o de desenvolvimento')
      assert.match(msg, /\.env\.local/)
      return true
    },
  )
  assert.equal(poolGuardado(), undefined, 'nem em desenvolvimento sobra pool de tentativa falha')
  assert.equal(dbGuardado(), undefined)
})

test('com a variável definida, o pool só nasce no primeiro acesso — e sem abrir conexão', async () => {
  process.env.DATABASE_URL = URL_FALSA
  assert.equal(poolGuardado(), undefined, 'definir a variável, sozinho, não constrói nada')

  const nome = mod.pool.options.application_name
  const criado = poolGuardado()
  assert.ok(criado, 'o pool apareceu só depois do primeiro acesso a uma propriedade')
  assert.match(nome ?? '', /^saas-analytics-multi10:/)
  assert.equal(criado.totalCount, 0, 'nenhuma conexão foi aberta')
  assert.equal(criado.idleCount, 0)
})

test('o pool sai configurado como escrito — e com ouvinte de erro', () => {
  const p = poolGuardado()!
  assert.equal(p.options.max, 10)
  assert.equal(p.options.connectionTimeoutMillis, 5_000)
  assert.equal(p.options.idleTimeoutMillis, 30_000)
  assert.equal(p.options.statement_timeout, 15_000)
  assert.equal(p.options.idle_in_transaction_session_timeout, 10_000)
  // Sem este ouvinte, um cliente ocioso que emite 'error' derruba o processo Node.
  assert.ok(p.listenerCount('error') > 0, 'o pool tem tratador de erro')
})

test('o cache do globalThis devolve sempre a mesma instância', () => {
  const primeiro = poolGuardado()
  void mod.pool.options
  void mod.db
  assert.equal(poolGuardado(), primeiro, 'nenhum acesso posterior recriou o pool')
})

/* Prova do `bind` da fachada E do dialeto, sem tocar em rede: montar a consulta
 * lê campos internos do drizzle (`this.dialect`, `this.session`). Se o Proxy
 * repassasse o método sem amarrar o `this`, isto lançaria. */
test('a fachada repassa método com o `this` certo — e o SQL sai em dialeto Postgres', () => {
  const { sql: texto } = mod.db.select().from(tenants).where(undefined).toSQL()
  assert.match(texto, /from "tenants"/)
  assert.doesNotMatch(texto, /`/, 'crase é citação do SQLite; o Postgres usa aspas duplas')
})

test('a fachada repassa os parâmetros como $1, não como ? do SQLite', () => {
  const { sql: texto, params } = mod.db
    .select()
    .from(tenants)
    .limit(1)
    .toSQL()
  assert.match(texto, /\$1/)
  assert.deepEqual(params, [1])
})
