import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron-auth'
import { acquireJobLock, releaseJobLock } from '@/lib/cron-lock'
import { db, pool } from '@/lib/db'
import { integrations, dataSources, tenantModules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { dailySync as googleDailySync } from '@/lib/ads/google'
import { dailySync as metaDailySync } from '@/lib/ads/meta'
import { dailySync as tiktokDailySync } from '@/lib/ads/tiktok'
import { ADS_PROVIDER_MODULE } from '@/lib/modules'
import { runSync } from '@/lib/sync/runner'

// ─── Result types ─────────────────────────────────────────────────────────────

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

// Trava global no Postgres: durante a migração Vercel → Railway as duas implantações
// dividem o banco, e uma segunda chamada simultânea (agendador duplicado, botão
// "Run workflow", a outra implantação) não pode rodar o sync de novo por cima.
// O TTL cobre folgado o sync mais longo (o job do Actions desiste em 15 min).
const LOCK_NAME = 'cron:all'
const LOCK_TTL_MS = 30 * 60 * 1000

function deploymentLabel(): string {
  if (process.env.RAILWAY_ENVIRONMENT_NAME) return 'railway'
  if (process.env.VERCEL) return 'vercel'
  return 'local'
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const owner = await acquireJobLock(pool, LOCK_NAME, { ttlMs: LOCK_TTL_MS, label: deploymentLabel() })
  if (!owner) {
    return NextResponse.json({ ok: true, skipped: 'locked' })
  }

  try {
    return NextResponse.json(await syncAll())
  } finally {
    await releaseJobLock(pool, LOCK_NAME, owner).catch((err: unknown) => {
      // sem release, a trava vence sozinha no TTL
      console.error('[cron/all] falha ao soltar a trava', err instanceof Error ? err.message : err)
    })
  }
}

async function syncAll() {
  const syncedAt = new Date().toISOString()

  // ── Load enabled modules set ───────────────────────────────────────────────
  const enabledRows = await db
    .select({ t: tenantModules.tenantId, k: tenantModules.moduleKey })
    .from(tenantModules)
    .where(eq(tenantModules.enabled, true))
  const enabled = new Set(enabledRows.map(r => `${r.t}:${r.k}`))

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

  return {
    ok: true,
    syncedAt,
    ads:   adsResults,
    sdr:   sdrResults,
  }
}
