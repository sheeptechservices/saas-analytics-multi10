import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { leadExtras, leads } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const { tenantId } = session.user
  const body = await req.json()

  const lead = await db.select().from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .then(r => r[0])

  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = await db.select().from(leadExtras)
    .where(eq(leadExtras.leadId, leadId))
    .then(r => r[0])

  const now = new Date()
  const data = {
    tags: JSON.stringify(body.tags ?? []),
    notes: body.notes ?? '',
    priority: body.priority ?? 'normal',
    customFields: JSON.stringify(body.customFields ?? {}),
    updatedAt: now,
  }

  if (existing) {
    await db.update(leadExtras).set(data).where(eq(leadExtras.leadId, leadId))
  } else {
    await db.insert(leadExtras).values({ id: uid(), leadId, tenantId, ...data })
  }

  return NextResponse.json({ ok: true })
}
