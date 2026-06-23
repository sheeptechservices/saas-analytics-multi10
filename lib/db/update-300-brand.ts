import { loadEnv } from './load-env'
loadEnv()
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import { eq } from 'drizzle-orm'

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'file:./data/app.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})
const db = drizzle(client, { schema })

async function main() {
  await db.update(schema.tenants).set({ primaryColor: '#E10504' }).where(eq(schema.tenants.slug, '300'))
  console.log('Tenant 300 -> primaryColor #E10504 OK')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
