/**
 * One-shot script: bootstrap the "300" tenant with SDR IA modules.
 * Safe to re-run — skips rows that already exist.
 *
 * Usage:
 *   npm run seed-300
 *   # or with custom creds:
 *   TENANT_300_EMAIL=admin@acme.com TENANT_300_PASSWORD=senha123 npm run seed-300
 */

import { loadEnv } from './load-env'
loadEnv()
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'

if (!process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL.startsWith('file:')) {
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true })
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'file:./data/app.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = drizzle(client, { schema })

const SDR_MODULES = ['integration.sdr-source', 'sdr.dashboard', 'sdr.parametros']

async function main() {
  const email    = process.env.TENANT_300_EMAIL    ?? 'admin@300.multi10.com'
  const password = process.env.TENANT_300_PASSWORD ?? 'Mult10@300!'
  const tenantName  = '300'
  const tenantSlug  = '300'

  // ── 1. Tenant ────────────────────────────────────────────────────────────────
  let tenantId: string

  const existingTenant = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, tenantSlug))
    .then(r => r[0])

  if (existingTenant) {
    tenantId = existingTenant.id
    console.log(`ℹ️  Tenant "${tenantName}" já existe  (id: ${tenantId})`)
  } else {
    tenantId = crypto.randomUUID()
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: tenantName,
      slug: tenantSlug,
      primaryColor: '#FFB400',
      createdAt: new Date(),
    })
    console.log(`✅ Tenant "${tenantName}" criado  (id: ${tenantId})`)
  }

  // ── 2. Admin user ─────────────────────────────────────────────────────────────
  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .then(r => r[0])

  if (existingUser) {
    console.log(`ℹ️  Usuário "${email}" já existe`)
  } else {
    await db.insert(schema.users).values({
      id: crypto.randomUUID(),
      tenantId,
      name: 'Admin 300',
      email,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
      avatarColor: '#FFFFFF',
      avatarBg: '#FFB400',
      createdAt: new Date(),
    })
    console.log(`✅ Usuário admin criado`)
    console.log(`   Email: ${email}`)
    console.log(`   Senha: ${password}`)
  }

  // ── 3. Modules ────────────────────────────────────────────────────────────────
  for (const moduleKey of SDR_MODULES) {
    const existing = await db
      .select({ tenantId: schema.tenantModules.tenantId })
      .from(schema.tenantModules)
      .where(
        and(
          eq(schema.tenantModules.tenantId, tenantId),
          eq(schema.tenantModules.moduleKey, moduleKey),
        )
      )
      .then(r => r[0])

    if (existing) {
      // Ensure it's enabled (in case it was toggled off)
      await db
        .update(schema.tenantModules)
        .set({ enabled: true })
        .where(
          and(
            eq(schema.tenantModules.tenantId, tenantId),
            eq(schema.tenantModules.moduleKey, moduleKey),
          )
        )
      console.log(`ℹ️  Módulo "${moduleKey}" já existia → enabled=true`)
    } else {
      await db.insert(schema.tenantModules).values({ tenantId, moduleKey, enabled: true })
      console.log(`✅ Módulo "${moduleKey}" habilitado`)
    }
  }

  console.log('')
  console.log('─────────────────────────────────────────────────────')
  console.log('Próximos passos:')
  console.log(`  1. Acesse o app como admin: ${email}`)
  console.log('  2. Vá em Configurações → Integrações → Fonte de Dados SDR')
  console.log('  3. Cole a connection string Postgres do projeto 300 e clique "Salvar e conectar"')
  console.log('  4. O backfill iniciará automaticamente em segundo plano')
  console.log('─────────────────────────────────────────────────────')

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
