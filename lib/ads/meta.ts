import { db } from '@/lib/db'
import { integrations, adCampaigns, adAdsets, adAds, adInsights } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

const META_API = 'https://graph.facebook.com/v19.0'

// ─── Credentials ───────────────────────────────────────────────────────────────

interface MetaCreds {
  integrationId: string
  accountId: string   // normalized to act_XXXXXXX
  accessToken: string // decrypted
}

async function getCreds(tenantId: string): Promise<MetaCreds> {
  const row = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, 'meta_ads')))
    .then(r => r[0])

  if (!row?.accountId || !row?.accessToken) {
    throw new Error('Meta Ads: credenciais incompletas')
  }

  const accountId = row.accountId.startsWith('act_')
    ? row.accountId
    : `act_${row.accountId}`

  return {
    integrationId: row.id,
    accountId,
    accessToken: decrypt(row.accessToken),
  }
}

// ─── Paginated GET ─────────────────────────────────────────────────────────────

async function metaGet(url: string, params: Record<string, string>): Promise<any[]> {
  const results: any[] = []
  const qs = new URLSearchParams(params)
  let nextUrl: string | null = `${url}?${qs}`

  while (nextUrl) {
    const res: Response = await fetch(nextUrl)
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Meta Ads API: ${res.status} ${txt.slice(0, 300)}`)
    }
    const data: any = await res.json()
    results.push(...(data.data ?? []))
    nextUrl = data.paging?.next ?? null
  }

  return results
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function monthBatches(start: Date, end: Date): Array<{ from: string; to: string }> {
  const batches: Array<{ from: string; to: string }> = []
  const cur = new Date(start)
  cur.setDate(1)
  while (cur <= end) {
    const from = cur.toISOString().slice(0, 10)
    const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
    const to = (last <= end ? last : end).toISOString().slice(0, 10)
    batches.push({ from, to })
    cur.setMonth(cur.getMonth() + 1)
  }
  return batches
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sumActions(
  actions: Array<{ action_type: string; value: string }> | undefined,
): number {
  if (!actions) return 0
  return actions.reduce((sum, a) => sum + Number(a.value ?? 0), 0)
}

// ─── Sync campaigns ────────────────────────────────────────────────────────────

async function syncCampaigns(tenantId: string, creds: MetaCreds): Promise<void> {
  const rows = await metaGet(`${META_API}/${creds.accountId}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    limit: '100',
    access_token: creds.accessToken,
  })

  const existing = await db
    .select({ id: adCampaigns.id, externalId: adCampaigns.externalId })
    .from(adCampaigns)
    .where(and(eq(adCampaigns.tenantId, tenantId), eq(adCampaigns.provider, 'meta_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'meta_ads' as const,
      externalId,
      name: row.name ?? '',
      status: row.status ?? null,
      objective: row.objective ?? null,
      dailyBudget: row.daily_budget ? Number(row.daily_budget) / 100 : null,
      lifetimeBudget: row.lifetime_budget ? Number(row.lifetime_budget) / 100 : null,
      currency: null,
      startDate: row.start_time ? row.start_time.slice(0, 10) : null,
      endDate: row.stop_time ? row.stop_time.slice(0, 10) : null,
      syncedAt,
    }

    const existingId = existingMap.get(externalId)
    if (existingId) {
      await db.update(adCampaigns).set(fields).where(eq(adCampaigns.id, existingId))
    } else {
      await db.insert(adCampaigns).values({ id: uid(), ...fields })
    }
  }
}

// ─── Sync adsets ───────────────────────────────────────────────────────────────

async function syncAdsets(tenantId: string, creds: MetaCreds): Promise<void> {
  const rows = await metaGet(`${META_API}/${creds.accountId}/adsets`, {
    fields: 'id,name,status,campaign_id,daily_budget',
    limit: '100',
    access_token: creds.accessToken,
  })

  const existing = await db
    .select({ id: adAdsets.id, externalId: adAdsets.externalId })
    .from(adAdsets)
    .where(and(eq(adAdsets.tenantId, tenantId), eq(adAdsets.provider, 'meta_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'meta_ads' as const,
      externalId,
      externalCampaignId: String(row.campaign_id ?? ''),
      name: row.name ?? '',
      status: row.status ?? null,
      dailyBudget: row.daily_budget ? Number(row.daily_budget) / 100 : null,
      syncedAt,
    }

    const existingId = existingMap.get(externalId)
    if (existingId) {
      await db.update(adAdsets).set(fields).where(eq(adAdsets.id, existingId))
    } else {
      await db.insert(adAdsets).values({ id: uid(), ...fields })
    }
  }
}

// ─── Sync ads ──────────────────────────────────────────────────────────────────

async function syncAds(tenantId: string, creds: MetaCreds): Promise<void> {
  const rows = await metaGet(`${META_API}/${creds.accountId}/ads`, {
    fields: 'id,name,status,adset_id,campaign_id,creative{id}',
    limit: '100',
    access_token: creds.accessToken,
  })

  const existing = await db
    .select({ id: adAds.id, externalId: adAds.externalId })
    .from(adAds)
    .where(and(eq(adAds.tenantId, tenantId), eq(adAds.provider, 'meta_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'meta_ads' as const,
      externalId,
      externalAdsetId: String(row.adset_id ?? ''),
      externalCampaignId: String(row.campaign_id ?? ''),
      name: row.name ?? '',
      status: row.status ?? null,
      type: null,
      syncedAt,
    }

    const existingId = existingMap.get(externalId)
    if (existingId) {
      await db.update(adAds).set(fields).where(eq(adAds.id, existingId))
    } else {
      await db.insert(adAds).values({ id: uid(), ...fields })
    }
  }
}

// ─── Sync insights batch ───────────────────────────────────────────────────────

async function syncInsightsBatch(
  tenantId: string,
  creds: MetaCreds,
  from: string,
  to: string,
): Promise<void> {
  const rows = await metaGet(`${META_API}/${creds.accountId}/insights`, {
    level: 'ad',
    fields: 'ad_id,adset_id,campaign_id,impressions,clicks,spend,reach,ctr,cpc,cpm,frequency,actions,action_values,date_start',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    limit: '100',
    access_token: creds.accessToken,
  })

  const existing = await db
    .select({ id: adInsights.id, externalAdId: adInsights.externalAdId, date: adInsights.date })
    .from(adInsights)
    .where(and(eq(adInsights.tenantId, tenantId), eq(adInsights.provider, 'meta_ads')))
  const existingMap = new Map(existing.map(r => [`${r.externalAdId}|${r.date}`, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalAdId = String(row.ad_id ?? '')
    const date = row.date_start ?? ''
    if (!externalAdId || !date) continue

    const spend = Number(row.spend ?? 0)
    const conversions = sumActions(row.actions)
    const conversionValue = sumActions(row.action_values)

    const fields = {
      tenantId,
      provider: 'meta_ads' as const,
      externalAdId,
      externalAdsetId: String(row.adset_id ?? ''),
      externalCampaignId: String(row.campaign_id ?? ''),
      date,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      spend,
      reach: Number(row.reach ?? 0),
      conversions,
      conversionValue,
      ctr: Number(row.ctr ?? 0),
      cpc: Number(row.cpc ?? 0),
      cpm: Number(row.cpm ?? 0),
      roas: spend > 0 ? conversionValue / spend : 0,
      frequency: Number(row.frequency ?? 0),
      syncedAt,
    }

    const existingId = existingMap.get(`${externalAdId}|${date}`)
    if (existingId) {
      await db.update(adInsights).set(fields).where(eq(adInsights.id, existingId))
    } else {
      await db.insert(adInsights).values({ id: uid(), ...fields })
    }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function fullSync(tenantId: string): Promise<void> {
  const creds = await getCreds(tenantId)

  await syncCampaigns(tenantId, creds)
  await syncAdsets(tenantId, creds)
  await syncAds(tenantId, creds)

  const endDate = new Date()
  const startDate = new Date()
  startDate.setFullYear(startDate.getFullYear() - 2)

  for (const { from, to } of monthBatches(startDate, endDate)) {
    await syncInsightsBatch(tenantId, creds, from, to)
  }

  await db.update(integrations)
    .set({ lastSyncAt: new Date() })
    .where(eq(integrations.id, creds.integrationId))
}

export async function dailySync(tenantId: string): Promise<void> {
  const creds = await getCreds(tenantId)

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 2)

  await syncCampaigns(tenantId, creds)
  await syncInsightsBatch(
    tenantId, creds,
    startDate.toISOString().slice(0, 10),
    endDate.toISOString().slice(0, 10),
  )

  await db.update(integrations)
    .set({ lastSyncAt: new Date() })
    .where(eq(integrations.id, creds.integrationId))
}
