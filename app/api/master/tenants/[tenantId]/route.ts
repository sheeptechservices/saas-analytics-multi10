import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

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
