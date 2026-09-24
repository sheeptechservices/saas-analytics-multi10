import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/* Marca e perfil caem no padrão quando a consulta falha; o portão de módulos
 * continua estourando. Aqui a falha é real, não simulada: o banco apontado é um
 * arquivo vazio, sem uma migração sequer, então qualquer SELECT levanta
 * "no such table". É o mesmo caminho de erro de um Turso inalcançável —
 * a promise da consulta rejeita — sem precisar mockar o drizzle.
 *
 * O banco de produção nunca entra: TURSO_DATABASE_URL é sobrescrito com um
 * file: temporário ANTES do primeiro import de @/lib/db, e o token é apagado. */

const PREFIXO = 'degradacao-test-'
let dir: string

let getTenantBranding: (id: string) => Promise<{ primaryColor: string; logoUrl: string | null; brandName: string }>
let BRANDING_PADRAO: { primaryColor: string; logoUrl: string | null; brandName: string }
let getUserProfile: (id: string) => Promise<{ name: string; photoUrl: string | null }>
let getEnabledModuleKeys: (id: string) => Promise<string[]>

function limparSobras() {
  const limite = Date.now() - 10 * 60_000
  for (const nome of readdirSync(tmpdir())) {
    if (!nome.startsWith(PREFIXO)) continue
    const caminho = join(tmpdir(), nome)
    try { if (statSync(caminho).mtimeMs < limite) rmSync(caminho, { recursive: true, force: true }) } catch {}
  }
}

const avisos: string[] = []
const warnOriginal = console.warn

before(async () => {
  limparSobras()
  dir = mkdtempSync(join(tmpdir(), PREFIXO))
  process.env.TURSO_DATABASE_URL = pathToFileURL(join(dir, 'vazio.db')).href
  delete process.env.TURSO_AUTH_TOKEN

  console.warn = (...args: unknown[]) => { avisos.push(args.map(String).join(' ')) }

  // Import dinâmico: o módulo lê a env na avaliação.
  ;({ getTenantBranding, BRANDING_PADRAO } = await import('@/lib/tenant'))
  ;({ getUserProfile } = await import('@/lib/user'))
  ;({ getEnabledModuleKeys } = await import('@/lib/entitlements'))
})

after(async () => {
  console.warn = warnOriginal
  const { client } = await import('@/lib/db')
  try { client.close() } catch {}
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
})

test('a consulta realmente falha neste banco — a premissa do teste', async () => {
  const { db } = await import('@/lib/db')
  await assert.rejects(db.run('select 1 from tenants'))
})

test('branding cai no padrão em vez de derrubar a árvore', async () => {
  const b = await getTenantBranding('tenant-qualquer')
  assert.deepEqual(b, BRANDING_PADRAO)
  assert.ok(avisos.some(l => l.startsWith('[tenant]')), 'deixou uma linha no log')
})

test('perfil cai em nome vazio + foto nula — e o layout escorrega para o nome da sessão', async () => {
  const p = await getUserProfile('user-qualquer')
  assert.deepEqual(p, { name: '', photoUrl: null })
  // app/(app)/layout.tsx faz `profile.name || name!`: nome vazio devolve o
  // controle para a sessão, que não depende do banco.
  const nomeDaSessao = 'Fulano da Sessão'
  assert.equal(p.name || nomeDaSessao, nomeDaSessao)
})

test('o portão de módulos NÃO degrada: a falha sobe para a fronteira de erro', async () => {
  await assert.rejects(
    getEnabledModuleKeys('tenant-qualquer'),
    'lista de módulos nunca pode virar um padrão silencioso',
  )
})

test('tenantId/userId vazio nem chega no banco', async () => {
  assert.deepEqual(await getTenantBranding(''), BRANDING_PADRAO)
  assert.deepEqual(await getUserProfile(''), { name: '', photoUrl: null })
  assert.deepEqual(await getEnabledModuleKeys(''), [])
})
