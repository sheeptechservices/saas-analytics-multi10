import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { refreshKommoToken, runKommoSync } from '@/lib/kommo/sync'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allIntegrations = await db.select().from(integrations)
    .where(eq(integrations.provider, 'kommo'))

  const results: Array<{ tenantId: string; status: string; synced?: number; error?: string }> = []

  for (const integration of allIntegrations) {
    if (!integration.accessToken || !integration.selectedPipelineId) {
      results.push({ tenantId: integration.tenantId, status: 'skipped' })
      continue
    }

    let activeToken = integration.accessToken
    const isExpired = integration.expiresAt && integration.expiresAt.getTime() < Date.now() + 5 * 60 * 1000
    if (isExpired) {
      const newToken = await refreshKommoToken(integration)
      if (!newToken) {
        results.push({ tenantId: integration.tenantId, status: 'token_expired' })
        continue
      }
      activeToken = newToken
    }

    try {
      const { synced } = await runKommoSync({ ...integration, accessToken: activeToken })
      results.push({ tenantId: integration.tenantId, status: 'success', synced })
    } catch (err: any) {
      console.error(`[cron/kommo-full-sync] tenant=${integration.tenantId}`, err?.message ?? err)
      results.push({ tenantId: integration.tenantId, status: 'error', error: err?.message ?? String(err) })
    }
  }

  return NextResponse.json({ ok: true, type: 'full', syncedAt: new Date().toISOString(), results })
}
