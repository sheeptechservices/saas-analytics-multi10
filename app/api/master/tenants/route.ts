import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { count, eq, desc } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      primaryColor: tenants.primaryColor,
      logoUrl: tenants.logoUrl,
      createdAt: tenants.createdAt,
      userCount: count(users.id),
    })
    .from(tenants)
    .leftJoin(users, eq(users.tenantId, tenants.id))
    .groupBy(tenants.id)
    .orderBy(desc(tenants.createdAt))

  return NextResponse.json({ tenants: rows })
}
