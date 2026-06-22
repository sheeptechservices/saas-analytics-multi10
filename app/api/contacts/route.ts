// GET /api/contacts?page=1&limit=50&q=...
//
// Response: { items: ContactItem[], total: number, page: number, limit: number }
//
// ContactItem: { id, name, phone, email, tags: string[], lastInteractionAt: ms|null, createdAt: ms|null }
//
// Requires module 'integration.ycloud-whatsapp'.
// lastInteractionAt / createdAt: mode:'timestamp' → Drizzle returns Date; .getTime() = epoch ms.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { contacts } from '@/lib/db/schema'
import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'

const MAX_LIMIT     = 100
const DEFAULT_LIMIT = 50

function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v * 1000  // stored as unix seconds when not in timestamp mode
  return null
}

function parseTags(raw: string): string[] {
  try { return JSON.parse(raw) as string[] } catch { return [] }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'integration.ycloud-whatsapp')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',                    10))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)))
  const q     = searchParams.get('q')?.trim() ?? ''
  const offset = (page - 1) * limit

  const baseWhere = and(
    eq(contacts.tenantId, tenantId),
    eq(contacts.source, 'ycloud-whatsapp'),
  )

  const where = q
    ? and(baseWhere, or(
        like(contacts.name,  `%${q}%`),
        like(contacts.phone, `%${q}%`),
      ))
    : baseWhere

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(contacts)
    .where(where)

  const rows = await db
    .select({
      id:                contacts.id,
      name:              contacts.name,
      phone:             contacts.phone,
      email:             contacts.email,
      tags:              contacts.tags,
      lastInteractionAt: contacts.lastInteractionAt,
      createdAt:         contacts.createdAt,
    })
    .from(contacts)
    .where(where)
    .orderBy(desc(contacts.lastInteractionAt))
    .limit(limit)
    .offset(offset)

  const items = rows.map(r => ({
    id:                r.id,
    name:              r.name,
    phone:             r.phone,
    email:             r.email,
    tags:              parseTags(r.tags),
    lastInteractionAt: toMs(r.lastInteractionAt),
    createdAt:         toMs(r.createdAt),
  }))

  return NextResponse.json({ items, total: Number(total), page, limit })
}
