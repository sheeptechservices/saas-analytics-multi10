import { db } from '@/lib/db'
import { plans, planModules } from '@/lib/db/schema'
import { PlansManager } from './PlansManager'

export default async function PlansPage() {
  const [allPlans, allModules] = await Promise.all([
    db.select().from(plans),
    db.select().from(planModules),
  ])

  const modulesByPlan = new Map<string, string[]>()
  for (const m of allModules) {
    if (!modulesByPlan.has(m.planId)) modulesByPlan.set(m.planId, [])
    modulesByPlan.get(m.planId)!.push(m.moduleKey)
  }

  const initialPlans = allPlans.map(p => ({
    id: p.id,
    name: p.name,
    modules: modulesByPlan.get(p.id) ?? [],
  }))

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1100 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#121316', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Planos
        </h1>
        <p style={{ fontSize: 13, color: '#666' }}>
          {allPlans.length} plano{allPlans.length !== 1 ? 's' : ''} cadastrado{allPlans.length !== 1 ? 's' : ''}.
        </p>
      </div>
      <PlansManager initialPlans={initialPlans} />
    </div>
  )
}
