import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrations, tenantModules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { refreshKommoToken, runKommoIncrementalSync } from '@/lib/kommo/sync'
import { dailySync as googleDailySync } from '@/lib/ads/google'
import { dailySync as metaDailySync } from '@/lib/ads/meta'
import { dailySync as tiktokDailySync } from '@/lib/ads/tiktok'
import { ADS_PROVIDER_MODULE } from '@/lib/modules'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Load enabled modules set ──────────────────────────────────────────────────

  const enabledRows = await db.select({ t: tenantModules.tenantId, k: tenantModules.moduleKey })
    .from(tenantModules).where(eq(tenantModules.enabled, true))
  const enabled = new Set(enabledRows.map(r => `${r.t}:${r.k}`))

  // ── Kommo incremental sync ────────────────────────────────────────────────────

  const allIntegrations = await db.select().from(integrations)
    .where(eq(integrations.provider, 'kommo'))

  const results: Array<{ tenantId: string; status: string; inserted?: number; updated?: number; error?: string }> = []

  for (const integration of allIntegrations) {
    if (!enabled.has(`${integration.tenantId}:integration.kommo`)) {
      results.push({ tenantId: integration.tenantId, status: 'module_disabled' })
      continue
    }

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
      const { inserted, updated } = await runKommoIncrementalSync({ ...integration, accessToken: activeToken })
      results.push({ tenantId: integration.tenantId, status: 'success', inserted, updated })
    } catch (err: any) {
      console.error(`[cron/kommo-sync] tenant=${integration.tenantId}`, err?.message ?? err)
      results.push({ tenantId: integration.tenantId, status: 'error', error: err?.message ?? String(err) })
    }
  }

  // ── Ads daily sync ────────────────────────────────────────────────────────────

  const providers = ['google_ads', 'meta_ads', 'tiktok_ads'] as const
  const syncFns = {
    google_ads: googleDailySync,
    meta_ads: metaDailySync,
    tiktok_ads: tiktokDailySync,
  }

  for (const provider of providers) {
    const activeIntegrations = await db
      .select()
      .from(integrations)
      .where(eq(integrations.provider, provider))

    for (const integration of activeIntegrations) {
      if (!enabled.has(`${integration.tenantId}:${ADS_PROVIDER_MODULE[provider]}`)) continue
      try {
        await syncFns[provider](integration.tenantId)
      } catch (e) {
        console.error(`${provider} daily sync failed for tenant ${integration.tenantId}`, e)
      }
    }
  }

  return NextResponse.json({ ok: true, type: 'incremental', syncedAt: new Date().toISOString(), results })
}
