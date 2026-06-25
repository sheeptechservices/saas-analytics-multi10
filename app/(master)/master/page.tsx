import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { count, eq, desc } from 'drizzle-orm'
import { fmtDateBr } from '@/lib/date'

export default async function MasterDashboard() {
  const [totalTenantsRow, totalUsersRow, tenantRows] = await Promise.all([
    db.select({ value: count() }).from(tenants).then(r => r[0]),
    db.select({ value: count() }).from(users).then(r => r[0]),
    db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        primaryColor: tenants.primaryColor,
        createdAt: tenants.createdAt,
        userCount: count(users.id),
      })
      .from(tenants)
      .leftJoin(users, eq(users.tenantId, tenants.id))
      .groupBy(tenants.id)
      .orderBy(desc(tenants.createdAt)),
  ])

  const totalTenants = totalTenantsRow.value
  const totalUsers = totalUsersRow.value

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#121316', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: '#666' }}>Visão geral da plataforma 300 Franchising.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 200px)', gap: 16, marginBottom: 40 }}>
        <StatCard label="Tenants" value={totalTenants} />
        <StatCard label="Usuários" value={totalUsers} />
      </div>

      {/* Tenant table */}
      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e3e4de' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#121316' }}>Todos os tenants</h2>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f6' }}>
              {['Nome', 'Slug', 'Usuários', 'Criado em', ''].map(h => (
                <th key={h} style={{
                  padding: '10px 20px', textAlign: 'left',
                  fontSize: 11, fontWeight: 700, color: '#888',
                  letterSpacing: '0.06em', borderBottom: '1px solid #e3e4de',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenantRows.map((t, i) => (
              <tr key={t.id} style={{ borderBottom: i < tenantRows.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: t.primaryColor, flexShrink: 0,
                      border: '1px solid rgba(0,0,0,0.1)',
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#121316' }}>{t.name}</span>
                  </div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: '#666',
                    background: '#f3f4f6', padding: '2px 8px', borderRadius: 4,
                    fontFamily: 'monospace',
                  }}>
                    {t.slug}
                  </span>
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: '#121316' }}>
                  {t.userCount}
                </td>
                <td style={{ padding: '14px 20px', fontSize: 12, color: '#888' }}>
                  {fmtDateBr(t.createdAt)}
                </td>
                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                  <a
                    href={`/master/tenants/${t.id}`}
                    style={{
                      fontSize: 12, fontWeight: 700,
                      color: '#7A5600', textDecoration: 'none',
                      padding: '5px 12px',
                      background: 'rgba(255,180,0,0.1)',
                      borderRadius: 6,
                      transition: 'background .15s',
                    }}
                  >
                    Ver detalhes
                  </a>
                </td>
              </tr>
            ))}
            {tenantRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>
                  Nenhum tenant cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e3e4de',
      borderRadius: 12,
      padding: '20px 24px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: '#121316', letterSpacing: '-0.03em' }}>
        {value}
      </div>
    </div>
  )
}
