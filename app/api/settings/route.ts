import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await db.select().from(tenants)
    .where(eq(tenants.id, session.user.tenantId))
    .then(r => r[0])

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const teamUsers = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    avatarColor: users.avatarColor,
    avatarBg: users.avatarBg,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.tenantId, session.user.tenantId))

  return NextResponse.json({ tenant, users: teamUsers })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { primaryColor, logoUrl, name } = body

  await db.update(tenants)
    .set({
      ...(primaryColor && { primaryColor }),
      ...(logoUrl !== undefined && { logoUrl }),
      ...(name && { name }),
    })
    .where(eq(tenants.id, session.user.tenantId))

  return NextResponse.json({ ok: true })
}
