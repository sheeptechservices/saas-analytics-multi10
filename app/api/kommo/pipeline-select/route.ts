import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pipelineKommoId, pipelineName } = await req.json()
  if (!pipelineKommoId) return NextResponse.json({ error: 'pipelineKommoId é obrigatório' }, { status: 400 })

  await db.update(integrations)
    .set({ selectedPipelineId: pipelineKommoId, selectedPipelineName: pipelineName ?? null })
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))

  return NextResponse.json({ ok: true })
}
