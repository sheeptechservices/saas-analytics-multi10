import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import { AuditExplorer } from './AuditExplorer'

export default async function AuditoriaPage() {
  const tenantList = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(asc(tenants.name))

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1200 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#121316', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Auditoria
        </h1>
        <p style={{ fontSize: 13, color: '#666' }}>Ações de todos os tenants, mais recentes primeiro.</p>
      </div>
      <AuditExplorer tenants={tenantList} />
    </div>
  )
}
