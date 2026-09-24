import { loadEnv } from './load-env'
loadEnv()
/* O cliente vem de ./index: ele lê DATABASE_URL só no PRIMEIRO USO, nunca na
 * importação — então o loadEnv() acima já rodou quando main() consulta. De
 * quebra, o script herda a configuração do pool e a decisão de TLS do app, em
 * vez de repetir uma conexão solta aqui. */
import { db } from './index'
import * as schema from './schema'
import { eq } from 'drizzle-orm'

async function main() {
  await db.update(schema.tenants).set({ primaryColor: '#E10504' }).where(eq(schema.tenants.slug, '300'))
  console.log('Tenant 300 -> primaryColor #E10504 OK')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
