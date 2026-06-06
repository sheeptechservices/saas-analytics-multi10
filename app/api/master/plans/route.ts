import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { plans, planModules } from '@/lib/db/schema'
import { ALL_MODULE_KEYS } from '@/lib/modules'

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [allPlans, allModules] = await Promise.all([
    db.select().from(plans),
    db.select().from(planModules),
  ])

  const modulesByPlan = new Map<string, string[]>()
  for (const m of allModules) {
    if (!modulesByPlan.has(m.planId)) modulesByPlan.set(m.planId, [])
    modulesByPlan.get(m.planId)!.push(m.moduleKey)
  }

  return NextResponse.json({
    plans: allPlans.map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      modules: modulesByPlan.get(p.id) ?? [],
    })),
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { name, modules } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Nome obrigatório.' }, { status: 400 })
    }

    const keys: string[] = (Array.isArray(modules) ? modules : [])
      .filter((k: unknown) => typeof k === 'string' && ALL_MODULE_KEYS.includes(k as string))

    const id = crypto.randomUUID()
    const createdAt = new Date()

    await db.insert(plans).values({ id, name: name.trim(), createdAt })

    if (keys.length > 0) {
      await db.insert(planModules).values(keys.map(moduleKey => ({ planId: id, moduleKey })))
    }

    return NextResponse.json({ ok: true, id }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/master/plans]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
