import { loadEnv } from './load-env'
loadEnv()
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import { ALL_MODULE_KEYS } from '../modules'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'

// Ensure data directory exists for local dev
if (!process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL.startsWith('file:')) {
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true })
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'file:./data/app.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = drizzle(client, { schema })

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function main() {
  // Check if already seeded
  const existing = await db.select().from(schema.tenants).limit(1)
  if (existing.length > 0) {
    console.log('Seed já executado. Apague o banco para re-seedar.')
    process.exit(0)
  }

  const tenantId = uid()
  const now = new Date()

  await db.insert(schema.tenants).values({
    id: tenantId,
    name: 'Multi10',
    slug: 'demo',
    primaryColor: '#FFB400',
    createdAt: now,
  })

  await db.insert(schema.tenantModules).values(
    ALL_MODULE_KEYS.map(moduleKey => ({ tenantId, moduleKey, enabled: true }))
  )

  await db.insert(schema.users).values([
    {
      id: uid(), tenantId,
      name: 'Admin Multi10', email: 'admin@multi10.com',
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin', avatarColor: '#FFB400', avatarBg: '#121316', createdAt: now,
    },
    // Os dois abaixo nascem com papel legado DE PROPÓSITO. A conta única acabou
    // com 'manager' e 'user' no produto — conta nova sai como 'admin' —, mas o
    // banco de produção ainda tem linhas assim e o código precisa tratá-las como
    // admin sem a migração drizzle/0011 ter rodado. Estas duas contas são a
    // forma de exercitar esse caminho localmente: entre com qualquer uma e a
    // tela tem que se comportar igualzinho à do admin acima.
    {
      id: uid(), tenantId,
      name: 'Carlos Mendes', email: 'carlos@multi10.com',
      passwordHash: bcrypt.hashSync('user123', 10),
      role: 'manager', avatarColor: '#9FE1CB', avatarBg: '#085041', createdAt: now,
    },
    {
      id: uid(), tenantId,
      name: 'Ana Lima', email: 'ana@multi10.com',
      passwordHash: bcrypt.hashSync('user123', 10),
      role: 'user', avatarColor: '#B5D4F4', avatarBg: '#0C447C', createdAt: now,
    },
  ])

  console.log('✅ Seed concluído.')
  console.log('   Tenant: Multi10 (demo)')
  console.log('   Login:  admin@multi10.com / admin123')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
