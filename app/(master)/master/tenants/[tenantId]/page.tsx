import { db } from '@/lib/db'
import { tenants, users, plans, planModules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { getEnabledModuleKeys } from '@/lib/entitlements'
import { TenantEditor } from './TenantEditor'

type Props = { params: Promise<{ tenantId: string }> }

const ROLE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  master:  { bg: '#ede9fe', color: '#5b21b6', label: 'master' },
  admin:   { bg: 'rgba(255,180,0,0.15)', color: '#7A5600', label: 'admin' },
  manager: { bg: '#dbeafe', color: '#1e40af', label: 'manager' },
  user:    { bg: '#f3f4f6', color: '#374151', label: 'user' },
}

export default async function TenantDetailPage({ params }: Props) {
  const { tenantId } = await params

  const [tenant, tenantUsers, enabledKeys, allPlans, allPlanModules] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)).then(r => r[0]),
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.tenantId, tenantId)),
    getEnabledModuleKeys(tenantId),
    db.select().from(plans),
    db.select().from(planModules),
  ])

  if (!tenant) notFound()

  const modulesByPlan = new Map<string, string[]>()
  for (const m of allPlanModules) {
    if (!modulesByPlan.has(m.planId)) modulesByPlan.set(m.planId, [])
    modulesByPlan.get(m.planId)!.push(m.moduleKey)
  }
  const plansList = allPlans.map(p => ({
    id: p.id,
    name: p.name,
    modules: modulesByPlan.get(p.id) ?? [],
  }))

  const createdAtDate = tenant.createdAt instanceof Date
    ? tenant.createdAt
    : new Date((tenant.createdAt as number) * 1000)

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1100 }}>
      {/* Back */}
      <a
        href="/master"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#666', textDecoration: 'none', marginBottom: 28 }}
      >
        ← Voltar
      </a>

      {/* Read-only context: slug + createdAt */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: tenant.primaryColor ?? '#FFB400',
            border: '2px solid rgba(0,0,0,0.08)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 18, fontWeight: 800, color: '#121316', letterSpacing: '-0.02em' }}>
            {tenant.name}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#666', background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
          {tenant.slug}
        </span>
        <span style={{ fontSize: 12, color: '#aaa' }}>
          Criado em {createdAtDate.toLocaleDateString('pt-BR')}
        </span>
      </div>

      {/* Editable form */}
      <TenantEditor
        tenantId={tenantId}
        initialName={tenant.name}
        initialColor={tenant.primaryColor ?? '#FFB400'}
        initialLogo={tenant.logoUrl ?? ''}
        enabledKeys={enabledKeys}
        plans={plansList}
      />

      {/* Users table */}
      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e3e4de' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#121316' }}>
            Usuários <span style={{ fontSize: 12, fontWeight: 600, color: '#aaa', marginLeft: 6 }}>{tenantUsers.length}</span>
          </h2>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f6' }}>
              {['Nome', 'E-mail', 'Role', 'Criado em'].map(h => (
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
            {tenantUsers.map((u, i) => {
              const badge = ROLE_BADGE[u.role] ?? ROLE_BADGE.user
              const uDate = u.createdAt instanceof Date
                ? u.createdAt
                : new Date((u.createdAt as number) * 1000)
              return (
                <tr key={u.id} style={{ borderBottom: i < tenantUsers.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                  <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: '#121316' }}>
                    {u.name}
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: '#555' }}>
                    {u.email}
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      background: badge.bg, color: badge.color,
                      padding: '3px 8px', borderRadius: 4,
                      letterSpacing: '0.04em',
                    }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 12, color: '#888' }}>
                    {uDate.toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              )
            })}
            {tenantUsers.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>
                  Nenhum usuário neste tenant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
