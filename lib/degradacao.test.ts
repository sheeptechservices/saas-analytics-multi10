import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

/* Marca e perfil caem no padrão quando a consulta falha; o portão de módulos
 * continua estourando. Aqui a falha é real, não simulada: DATABASE_URL aponta
 * para 127.0.0.1:1, porta onde nunca há nada escutando, então toda consulta
 * rejeita com ECONNREFUSED na hora. É exatamente o caminho de erro de um banco
 * inalcançável — e sem mockar o drizzle nem esperar timeout.
 *
 * (No tempo do Turso o mesmo teste apontava para um arquivo SQLite vazio e a
 * falha era "no such table". Com Postgres não existe arquivo local para apontar,
 * e "banco fora do ar" é a falha que o app realmente precisa aguentar.)
 *
 * Nenhum banco real entra: a URL é 127.0.0.1, sobrescrita ANTES do primeiro
 * import de @/lib/db, que só lê a variável no primeiro uso. */

// Porta 1 é privilegiada e nunca tem serviço: o sistema recusa na hora, sem DNS
// e sem tráfego para fora da máquina.
const URL_RECUSADA = 'postgres://ninguem:nada@127.0.0.1:1/inexistente'

let getTenantBranding: (id: string) => Promise<{ primaryColor: string; logoUrl: string | null; brandName: string }>
let BRANDING_PADRAO: { primaryColor: string; logoUrl: string | null; brandName: string }
let getUserProfile: (id: string) => Promise<{ name: string; photoUrl: string | null }>
let getEnabledModuleKeys: (id: string) => Promise<string[]>

const avisos: string[] = []
const warnOriginal = console.warn
const errorOriginal = console.error
const urlOriginal = process.env.DATABASE_URL

before(async () => {
  process.env.DATABASE_URL = URL_RECUSADA
  delete process.env.PGSSLMODE

  console.warn = (...args: unknown[]) => { avisos.push(args.map(String).join(' ')) }
  // O pool loga '[db] conexão ociosa caiu' quando a conexão morre; é ruído esperado aqui.
  console.error = () => {}

  // Import dinâmico: garante que a env já está trocada antes do primeiro uso.
  ;({ getTenantBranding, BRANDING_PADRAO } = await import('@/lib/tenant'))
  ;({ getUserProfile } = await import('@/lib/user'))
  ;({ getEnabledModuleKeys } = await import('@/lib/entitlements'))
})

after(async () => {
  console.warn = warnOriginal
  console.error = errorOriginal
  const { pool } = await import('@/lib/db')
  try { await pool.end() } catch {}
  if (urlOriginal === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = urlOriginal
})

test('a consulta realmente falha neste banco — a premissa do teste', async () => {
  const { db } = await import('@/lib/db')
  await assert.rejects(db.execute('select 1 from tenants'))
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
