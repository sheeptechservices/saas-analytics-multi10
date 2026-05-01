import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { leads, leadExtras, stages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user

  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      responsibleName: leads.responsibleName,
      price: leads.price,
      stageId: leads.stageId,
      pipelineId: leads.pipelineId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      stageName: stages.name,
      stageColor: stages.color,
      stageOrder: stages.order,
      extrasTags: leadExtras.tags,
      extrasNotes: leadExtras.notes,
      extrasPriority: leadExtras.priority,
      extrasCustom: leadExtras.customFields,
      extrasId: leadExtras.id,
    })
    .from(leads)
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .leftJoin(leadExtras, eq(leads.id, leadExtras.leadId))
    .where(eq(leads.tenantId, tenantId))

  const result = rows.map(r => ({
    id: r.id,
    name: r.name,
    responsibleName: r.responsibleName,
    price: r.price,
    stageId: r.stageId,
    pipelineId: r.pipelineId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    stage: { id: r.stageId, name: r.stageName ?? '', color: r.stageColor ?? '#AAAAAA', order: r.stageOrder ?? 0 },
    extras: r.extrasId ? {
      id: r.extrasId,
      tags: JSON.parse(r.extrasTags ?? '[]'),
      notes: r.extrasNotes ?? '',
      priority: r.extrasPriority ?? 'normal',
      customFields: JSON.parse(r.extrasCustom ?? '{}'),
    } : null,
  }))

  return NextResponse.json(result)
}
