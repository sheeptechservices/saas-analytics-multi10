import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { refreshKommoToken, runKommoSync, runKommoIncrementalSync } from '@/lib/kommo/sync'

const yield_ = () => new Promise<void>(resolve => setImmediate(resolve))

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration?.accessToken || !integration?.accountDomain) {
    return NextResponse.json({ error: 'Kommo não conectado' }, { status: 400 })
  }

  const isExpired = integration.expiresAt && integration.expiresAt.getTime() < Date.now() + 5 * 60 * 1000
  if (isExpired) {
    const newToken = await refreshKommoToken(integration)
    if (!newToken) {
      return NextResponse.json({ error: 'Token do Kommo expirado. Reconecte a integração.' }, { status: 401 })
    }
    integration = { ...integration, accessToken: newToken }
  }

  if (!integration.selectedPipelineId) {
    return NextResponse.json({ error: 'Selecione um funil antes de sincronizar' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const full = searchParams.get('full') === 'true'

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        await yield_()
      }

      try {
        if (full) {
          await runKommoSync(integration, emit)
        } else {
          await runKommoIncrementalSync(integration, emit)
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        console.error('[kommo/sync] ERROR:', msg)
        try { await emit({ stage: 'error', error: `Erro: ${msg}` }) } catch {}
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  })
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration) return NextResponse.json({ status: 'disconnected', lastSyncAt: null })

  const now = new Date()
  let status = 'disconnected'
  if (integration.accessToken) {
    status = integration.expiresAt && integration.expiresAt < now ? 'expired' : 'connected'
  } else if (integration.clientId) {
    status = 'configured'
  }

  return NextResponse.json({
    status,
    accountDomain: integration.accountDomain,
    lastSyncAt: integration.lastSyncAt,
    hasCredentials: !!(integration.clientId && integration.clientSecret),
    selectedPipelineId: integration.selectedPipelineId ?? null,
    selectedPipelineName: integration.selectedPipelineName ?? null,
  })
}
