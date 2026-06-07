import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrations, dataSources, tenantModules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { refreshKommoToken, runKommoIncrementalSync, runKommoSync } from '@/lib/kommo/sync'
import { dailySync as googleDailySync } from '@/lib/ads/google'
import { dailySync as metaDailySync } from '@/lib/ads/meta'
import { dailySync as tiktokDailySync } from '@/lib/ads/tiktok'
import { ADS_PROVIDER_MODULE } from '@/lib/modules'
import { runSync } from '@/lib/sync/runner'

// ─── Result types ─────────────────────────────────────────────────────────────

type KommoResult = {
  tenantId: string
  status: string
  inserted?: number
  updated?: number
  synced?: number
  error?: string
}

type AdsResult = {
  tenantId: string
  provider: string
  status: string
  error?: string
}

type SdrResult = {
  dataSourceId: string
  tenantId: string
  providerKey: string
  status: string
  counts?: object
  error?: string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isSunday = new Date().getUTCDay() === 0
  const syncedAt = new Date().toISOString()

  // ── Load enabled modules set ───────────────────────────────────────────────
  const enabledRows = await db
    .select({ t: tenantModules.tenantId, k: tenantModules.moduleKey })
    .from(tenantModules)
    .where(eq(tenantModules.enabled, true))
  const enabled = new Set(enabledRows.map(r => `${r.t}:${r.k}`))

  // ── Bloco KOMMO ───────────────────────────────────────────────────────────
  const kommoResults: KommoResult[] = []

  const allIntegrations = await db
    .select()
    .from(integrations)
    .where(eq(integrations.provider, 'kommo'))

  for (const integration of allIntegrations) {
    if (!enabled.has(`${integration.tenantId}:integration.kommo`)) {
      kommoResults.push({ tenantId: integration.tenantId, status: 'module_disabled' })
      continue
    }

    if (!integration.accessToken || !integration.selectedPipelineId) {
      kommoResults.push({ tenantId: integration.tenantId, status: 'skipped' })
      continue
    }

    let activeToken = integration.accessToken
    const isExpired = integration.expiresAt && integration.expiresAt.getTime() < Date.now() + 5 * 60 * 1000
    if (isExpired) {
      const newToken = await refreshKommoToken(integration)
      if (!newToken) {
        kommoResults.push({ tenantId: integration.tenantId, status: 'token_expired' })
        continue
      }
      activeToken = newToken
    }

    try {
      if (isSunday) {
        const { synced } = await runKommoSync({ ...integration, accessToken: activeToken })
        kommoResults.push({ tenantId: integration.tenantId, status: 'success', synced })
      } else {
        const { inserted, updated } = await runKommoIncrementalSync({ ...integration, accessToken: activeToken })
        kommoResults.push({ tenantId: integration.tenantId, status: 'success', inserted, updated })
      }
    } catch (err: any) {
      console.error(`[cron/all] kommo tenant=${integration.tenantId}`, err?.message ?? err)
      kommoResults.push({ tenantId: integration.tenantId, status: 'error', error: err?.message ?? String(err) })
    }
  }

  // ── Bloco ADS ─────────────────────────────────────────────────────────────
  const adsResults: AdsResult[] = []

  const adProviders = ['google_ads', 'meta_ads', 'tiktok_ads'] as const
  const adsSyncFns: Record<typeof adProviders[number], (tenantId: string) => Promise<void>> = {
    google_ads: googleDailySync,
    meta_ads:   metaDailySync,
    tiktok_ads: tiktokDailySync,
  }

  for (const provider of adProviders) {
    const activeIntegrations = await db
      .select()
      .from(integrations)
      .where(eq(integrations.provider, provider))

    for (const integration of activeIntegrations) {
      if (!enabled.has(`${integration.tenantId}:${ADS_PROVIDER_MODULE[provider]}`)) {
        adsResults.push({ tenantId: integration.tenantId, provider, status: 'module_disabled' })
        continue
      }
      try {
        await adsSyncFns[provider](integration.tenantId)
        adsResults.push({ tenantId: integration.tenantId, provider, status: 'success' })
      } catch (e: any) {
        console.error(`[cron/all] ${provider} tenant=${integration.tenantId}`, e?.message ?? e)
        adsResults.push({ tenantId: integration.tenantId, provider, status: 'error', error: e?.message ?? String(e) })
      }
    }
  }

  // ── Bloco SDR ─────────────────────────────────────────────────────────────
  const sdrResults: SdrResult[] = []

  const sources = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.status, 'connected'))

  for (const ds of sources) {
    if (!enabled.has(`${ds.tenantId}:integration.sdr-source`)) {
      sdrResults.push({ dataSourceId: ds.id, tenantId: ds.tenantId, providerKey: ds.providerKey, status: 'module_disabled' })
      continue
    }
    try {
      const result = await runSync(ds)
      sdrResults.push({ dataSourceId: ds.id, tenantId: ds.tenantId, providerKey: ds.providerKey, status: result.status, counts: result.counts, error: result.error })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron/all] sdr dataSource=${ds.id} tenant=${ds.tenantId}`, msg)
      sdrResults.push({ dataSourceId: ds.id, tenantId: ds.tenantId, providerKey: ds.providerKey, status: 'error', error: msg })
    }
  }

  return NextResponse.json({
    ok: true,
    mode: isSunday ? 'full' : 'incremental',
    syncedAt,
    kommo: kommoResults,
    ads:   adsResults,
    sdr:   sdrResults,
  })
}
