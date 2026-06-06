import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import { ALL_MODULE_KEYS } from '../modules'
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
  const allTenants = await db.select({ id: schema.tenants.id }).from(schema.tenants)

  let total = 0
  for (const tenant of allTenants) {
    const rows = ALL_MODULE_KEYS.map(moduleKey => ({
      tenantId: tenant.id,
      moduleKey,
      enabled: true,
    }))
    await db.insert(schema.tenantModules).values(rows).onConflictDoNothing()
    total += rows.length
  }

  console.log(`✅ Backfill concluído: ${allTenants.length} tenant(s), ${total} linhas garantidas.`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
