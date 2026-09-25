import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'

/* A tela /reset-password mostra de quem é a conta antes de a pessoa escolher a
 * senha. O que importa provar: só link vivo revela nome e e-mail, e "vivo" é a
 * mesma regra que o POST usa para aceitar a senha. */

let banco: BancoDeTeste
let db: BancoDeTeste['db']
let donoDoLink: typeof import('@/lib/link-senha')['donoDoLink']
let usarLinkEGravarSenha: typeof import('@/lib/link-senha')['usarLinkEGravarSenha']
let esquema: typeof import('@/lib/db/schema')

const AGORA = 1_800_000_000_000
const HORA = 60 * 60 * 1000

before(async () => {
  banco = await bancoDeTeste()
  db = banco.db
  usarComoBancoDoApp(db)
  esquema = await import('@/lib/db/schema')
  ;({ donoDoLink, usarLinkEGravarSenha } = await import('@/lib/link-senha'))
})

after(async () => {
  soltarBancoDoApp()
  await banco.fechar()
})

beforeEach(async () => {
  await db.delete(esquema.passwordResetTokens)
  await db.delete(esquema.users)
  await db.delete(esquema.tenants)
  await db.insert(esquema.tenants).values({ id: 't1', name: 'Cliente', slug: 'cliente', createdAt: new Date() })
  await db.insert(esquema.users).values({
    id: 'u1', tenantId: 't1', name: 'Fulana de Tal', email: 'fulana@exemplo.com',
    passwordHash: 'x', role: 'admin', createdAt: new Date(),
  })
})

async function link(token: string, campos: { expiresAt: number; usedAt?: number }) {
  await db.insert(esquema.passwordResetTokens).values({
    id: `id-${token}`, userId: 'u1', token, createdAt: AGORA - HORA, ...campos,
  })
}

test('link vivo devolve o nome e o e-mail da conta', async () => {
  await link('vivo', { expiresAt: AGORA + HORA })
  assert.deepEqual(await donoDoLink('vivo', AGORA), { nome: 'Fulana de Tal', email: 'fulana@exemplo.com' })
})

test('link já usado não revela nada', async () => {
  await link('usado', { expiresAt: AGORA + HORA, usedAt: AGORA - 1 })
  assert.equal(await donoDoLink('usado', AGORA), null)
})

test('link vencido não revela nada — inclusive no instante exato do vencimento', async () => {
  await link('vencido', { expiresAt: AGORA - 1 })
  await link('no-limite', { expiresAt: AGORA })
  assert.equal(await donoDoLink('vencido', AGORA), null)
  assert.equal(await donoDoLink('no-limite', AGORA), null)
})

test('token inexistente não revela nada', async () => {
  await link('vivo', { expiresAt: AGORA + HORA })
  assert.equal(await donoDoLink('outro', AGORA), null)
  assert.equal(await donoDoLink('', AGORA), null)
})

// ── Uso único ────────────────────────────────────────────────────────────────

async function hashNoBanco() {
  return db.select({ h: esquema.users.passwordHash }).from(esquema.users).then(r => r[0].h)
}

test('o link grava a senha uma vez; a segunda tentativa é recusada e não mexe na senha', async () => {
  await link('vivo', { expiresAt: AGORA + HORA })

  assert.equal(await usarLinkEGravarSenha('vivo', 'hash-1', AGORA), true)
  assert.equal(await hashNoBanco(), 'hash-1')

  assert.equal(await usarLinkEGravarSenha('vivo', 'hash-2', AGORA + 1), false)
  assert.equal(await hashNoBanco(), 'hash-1', 'o segundo uso não pode trocar a senha')
  assert.equal(await donoDoLink('vivo', AGORA + 1), null, 'depois de usado, a tela também o recusa')
})

test('dois envios simultâneos do mesmo link: só um grava', async () => {
  await link('vivo', { expiresAt: AGORA + HORA })
  const r = await Promise.all([
    usarLinkEGravarSenha('vivo', 'hash-a', AGORA),
    usarLinkEGravarSenha('vivo', 'hash-b', AGORA),
  ])
  assert.equal(r.filter(Boolean).length, 1)
  assert.equal(await hashNoBanco(), r[0] ? 'hash-a' : 'hash-b')
})

test('link usado ou vencido não grava senha', async () => {
  await link('usado', { expiresAt: AGORA + HORA, usedAt: AGORA - 1 })
  await link('vencido', { expiresAt: AGORA - 1 })
  assert.equal(await usarLinkEGravarSenha('usado', 'hash-x', AGORA), false)
  assert.equal(await usarLinkEGravarSenha('vencido', 'hash-x', AGORA), false)
  assert.equal(await hashNoBanco(), 'x')
})

// A tela e o POST não podem discordar sobre o que é um link vivo.
test('o POST da rota grava pelo caminho de uso único, e o GET não vai para cache', () => {
  const rota = readFileSync(path.join(process.cwd(), 'app/api/auth/reset-password/route.ts'), 'utf8')
  assert.ok(rota.includes('usarLinkEGravarSenha(token, passwordHash)'), 'o POST deixou de usar usarLinkEGravarSenha')
  assert.ok(!/\.update\(|\.select\(/.test(rota), 'o POST voltou a consultar o banco por conta própria')
  assert.ok(rota.includes("'Cache-Control': 'no-store'"), 'o GET leva nome e e-mail: não pode ir para cache')
})
