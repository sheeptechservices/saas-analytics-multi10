import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { count, eq, desc } from 'drizzle-orm'

export default async function TenantsPage() {
  const rows = await db
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
    .orderBy(desc(tenants.createdAt))

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#121316', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Tenants
        </h1>
        <p style={{ fontSize: 13, color: '#666' }}>{rows.length} tenant{rows.length !== 1 ? 's' : ''} cadastrado{rows.length !== 1 ? 's' : ''}.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, overflow: 'hidden' }}>
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
            {rows.map((t, i) => (
              <tr key={t.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
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
                  {t.createdAt instanceof Date
                    ? t.createdAt.toLocaleDateString('pt-BR')
                    : new Date(t.createdAt as number * 1000).toLocaleDateString('pt-BR')}
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
                    }}
                  >
                    Ver detalhes
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
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
