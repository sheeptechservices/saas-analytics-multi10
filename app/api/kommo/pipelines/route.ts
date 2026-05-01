import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration?.accessToken || !integration?.accountDomain) {
    return NextResponse.json({ error: 'Kommo não conectado' }, { status: 400 })
  }

  try {
    const base = `https://${integration.accountDomain}.kommo.com/api/v4`
    const res = await fetch(`${base}/leads/pipelines`, {
      headers: { Authorization: `Bearer ${integration.accessToken}` },
    })
    if (!res.ok) return NextResponse.json({ error: 'Erro ao buscar funis' }, { status: 500 })

    const data = await res.json()
    const pipelineList = (data._embedded?.pipelines ?? [])
      .filter((p: any) => !p.is_archive)
      .map((p: any) => ({
        kommoId: String(p.id),
        name: p.name,
        stagesCount: (p._embedded?.statuses ?? []).length,
      }))

    return NextResponse.json({
      pipelines: pipelineList,
      selectedPipelineId: integration.selectedPipelineId ?? null,
      selectedPipelineName: integration.selectedPipelineName ?? null,
    })
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar funis' }, { status: 500 })
  }
}
