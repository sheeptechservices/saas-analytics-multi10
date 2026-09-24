import { loadEnv } from './load-env'
loadEnv()
/* O cliente vem de ./index: ele lê DATABASE_URL só no PRIMEIRO USO, nunca na
 * importação — então o loadEnv() acima já rodou quando main() consulta. De
 * quebra, o script herda a configuração do pool e a decisão de TLS do app, em
 * vez de repetir uma conexão solta aqui. */
import { db } from './index'
import * as schema from './schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

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
