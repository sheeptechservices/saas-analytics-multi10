import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { tenants, users, tenantModules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ALL_MODULE_KEYS } from '@/lib/modules'

type Params = { params: Promise<{ tenantId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { tenantId } = await params

  const [tenant, tenantUsers] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)).then(r => r[0] ?? null),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId)),
  ])

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  return NextResponse.json({ tenant, users: tenantUsers })
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { tenantId } = await params

  try {
    const body = await req.json()
    const { name, primaryColor, logoUrl, modules } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Nome inválido' }, { status: 400 })
    }

    const enabledKeys: string[] = (Array.isArray(modules) ? modules : [])
      .filter((k: unknown) => typeof k === 'string' && ALL_MODULE_KEYS.includes(k as string))

    await db
      .update(tenants)
      .set({ name: name.trim(), primaryColor: primaryColor ?? null, logoUrl: logoUrl || null })
      .where(eq(tenants.id, tenantId))

    for (const key of ALL_MODULE_KEYS) {
      await db
        .insert(tenantModules)
        .values({ tenantId, moduleKey: key, enabled: enabledKeys.includes(key) })
        .onConflictDoUpdate({
          target: [tenantModules.tenantId, tenantModules.moduleKey],
          set: { enabled: enabledKeys.includes(key) },
        })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/master/tenants]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
