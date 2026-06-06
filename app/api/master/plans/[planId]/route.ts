import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { plans, planModules } from '@/lib/db/schema'
import { ALL_MODULE_KEYS } from '@/lib/modules'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ planId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { planId } = await params

  try {
    const body = await req.json()
    const { name, modules } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Nome obrigatório.' }, { status: 400 })
    }

    const keys: string[] = (Array.isArray(modules) ? modules : [])
      .filter((k: unknown) => typeof k === 'string' && ALL_MODULE_KEYS.includes(k as string))

    await db.update(plans).set({ name: name.trim() }).where(eq(plans.id, planId))
    await db.delete(planModules).where(eq(planModules.planId, planId))

    if (keys.length > 0) {
      await db.insert(planModules).values(keys.map(moduleKey => ({ planId, moduleKey })))
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/master/plans]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { planId } = await params

  try {
    await db.delete(planModules).where(eq(planModules.planId, planId))
    await db.delete(plans).where(eq(plans.id, planId))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/master/plans]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
