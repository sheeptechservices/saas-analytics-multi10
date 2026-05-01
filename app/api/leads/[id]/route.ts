import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { leads, stages, pipelines, leadExtras } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId } = session.user
  const { id } = await params
  const { stageId } = await req.json() as { stageId: string }

  await db
    .update(leads)
    .set({ stageId, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))

  return NextResponse.json({ ok: true })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId } = session.user
  const { id } = await params

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
    .limit(1)

  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [stage] = await db.select().from(stages).where(eq(stages.id, lead.stageId)).limit(1)
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, lead.pipelineId)).limit(1)
  const [extras] = await db.select().from(leadExtras).where(eq(leadExtras.leadId, id)).limit(1)

  return NextResponse.json({
    ...lead,
    stage: stage ?? null,
    pipeline: pipeline ?? null,
    extras: extras
      ? { ...extras, tags: JSON.parse(extras.tags), customFields: JSON.parse(extras.customFields) }
      : null,
  })
}
