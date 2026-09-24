import { loadEnv } from './load-env'
loadEnv()
/* O cliente vem de ./index: ele lê DATABASE_URL só no PRIMEIRO USO, nunca na
 * importação — então o loadEnv() acima já rodou quando main() consulta. De
 * quebra, o script herda a configuração do pool e a decisão de TLS do app, em
 * vez de repetir uma conexão solta aqui. */
import { db } from './index'
import * as schema from './schema'
import { ALL_MODULE_KEYS } from '../modules'

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
