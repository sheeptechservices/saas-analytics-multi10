import { loadEnv } from './load-env'
loadEnv()
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import { eq } from 'drizzle-orm'
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

async function main() {
  const email = process.env.MASTER_EMAIL ?? 'master@multi10.com'
  const password = process.env.MASTER_PASSWORD ?? 'master123'

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .then(r => r[0])

  if (existing) {
    console.log(`Master já existe: ${email}`)
    process.exit(0)
  }

  await db.insert(schema.users).values({
    id: crypto.randomUUID(),
    tenantId: null,
    name: 'Master',
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'master',
    avatarColor: '#FFFFFF',
    avatarBg: '#5b21b6',
    createdAt: new Date(),
  })

  console.log(`✅ Master criado.`)
  console.log(`   Email:  ${email}`)
  console.log(`   Senha:  ${password}`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
