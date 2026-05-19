import { db } from '@/lib/db'
import { integrations, adCampaigns, adAdsets, adAds, adInsights } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3'

// ─── Credentials ───────────────────────────────────────────────────────────────

interface TikTokCreds {
  integrationId: string
  advertiserId: string
  accessToken: string  // decrypted
}

async function getCreds(tenantId: string): Promise<TikTokCreds> {
  const row = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, 'tiktok_ads')))
    .then(r => r[0])

  if (!row?.accountId || !row?.accessToken) {
    throw new Error('TikTok Ads: credenciais incompletas')
  }

  return {
    integrationId: row.id,
    advertiserId: row.accountId,
    accessToken: decrypt(row.accessToken),
  }
}

// ─── Paginated GET ─────────────────────────────────────────────────────────────

async function tiktokGet(
  endpoint: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<any[]> {
  const results: any[] = []
  let page = 1

  while (true) {
    const qs = new URLSearchParams({ ...params, page: String(page), page_size: '100' })
    const res = await fetch(`${TIKTOK_API}${endpoint}?${qs}`, {
      headers: { 'Access-Token': accessToken },
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`TikTok Ads API: ${res.status} ${txt.slice(0, 300)}`)
    }
    const data = await res.json()
    if (data.code !== 0) {
      throw new Error(`TikTok Ads API erro: ${data.message ?? data.code}`)
    }
    const list: any[] = data.data?.list ?? []
    results.push(...list)

    const pageInfo = data.data?.page_info ?? {}
    if (page >= (pageInfo.total_page ?? 1) || list.length === 0) break
    page++
  }

  return results
}

// ─── Paginated report GET ──────────────────────────────────────────────────────

async function tiktokReport(
  params: Record<string, string>,
  accessToken: string,
): Promise<any[]> {
  const results: any[] = []
  let page = 1

  while (true) {
    const qs = new URLSearchParams({ ...params, page: String(page), page_size: '100' })
    const res = await fetch(`${TIKTOK_API}/report/integrated/get/?${qs}`, {
      headers: { 'Access-Token': accessToken },
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`TikTok Report API: ${res.status} ${txt.slice(0, 300)}`)
    }
    const data = await res.json()
    if (data.code !== 0) {
      throw new Error(`TikTok Report API erro: ${data.message ?? data.code}`)
    }
    const list: any[] = data.data?.list ?? []
    results.push(...list)

    const pageInfo = data.data?.page_info ?? {}
    if (page >= (pageInfo.total_page ?? 1) || list.length === 0) break
    page++
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

// ─── Sync campaigns ────────────────────────────────────────────────────────────

async function syncCampaigns(tenantId: string, creds: TikTokCreds): Promise<void> {
  const rows = await tiktokGet('/campaign/get/', {
    advertiser_id: creds.advertiserId,
    fields: JSON.stringify(['campaign_id', 'campaign_name', 'status', 'objective_type', 'budget', 'budget_mode', 'create_time', 'modify_time']),
  }, creds.accessToken)

  const existing = await db
    .select({ id: adCampaigns.id, externalId: adCampaigns.externalId })
    .from(adCampaigns)
    .where(and(eq(adCampaigns.tenantId, tenantId), eq(adCampaigns.provider, 'tiktok_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.campaign_id ?? '')
    if (!externalId) continue

    const isDaily = row.budget_mode === 'BUDGET_MODE_DAY'
    const fields = {
      tenantId,
      provider: 'tiktok_ads' as const,
      externalId,
      name: row.campaign_name ?? '',
      status: row.status ?? null,
      objective: row.objective_type ?? null,
      dailyBudget: isDaily ? Number(row.budget ?? 0) : null,
      lifetimeBudget: !isDaily ? Number(row.budget ?? 0) : null,
      currency: null,
      startDate: null,
      endDate: null,
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

// ─── Sync ad groups (adsets) ───────────────────────────────────────────────────

async function syncAdsets(tenantId: string, creds: TikTokCreds): Promise<void> {
  const rows = await tiktokGet('/adgroup/get/', {
    advertiser_id: creds.advertiserId,
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'status', 'campaign_id', 'budget', 'budget_mode']),
  }, creds.accessToken)

  const existing = await db
    .select({ id: adAdsets.id, externalId: adAdsets.externalId })
    .from(adAdsets)
    .where(and(eq(adAdsets.tenantId, tenantId), eq(adAdsets.provider, 'tiktok_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.adgroup_id ?? '')
    if (!externalId) continue

    const isDaily = row.budget_mode === 'BUDGET_MODE_DAY'
    const fields = {
      tenantId,
      provider: 'tiktok_ads' as const,
      externalId,
      externalCampaignId: String(row.campaign_id ?? ''),
      name: row.adgroup_name ?? '',
      status: row.status ?? null,
      dailyBudget: isDaily ? Number(row.budget ?? 0) : null,
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

async function syncAds(tenantId: string, creds: TikTokCreds): Promise<void> {
  const rows = await tiktokGet('/ad/get/', {
    advertiser_id: creds.advertiserId,
    fields: JSON.stringify(['ad_id', 'ad_name', 'status', 'adgroup_id', 'campaign_id', 'ad_format']),
  }, creds.accessToken)

  const existing = await db
    .select({ id: adAds.id, externalId: adAds.externalId })
    .from(adAds)
    .where(and(eq(adAds.tenantId, tenantId), eq(adAds.provider, 'tiktok_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.ad_id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'tiktok_ads' as const,
      externalId,
      externalAdsetId: String(row.adgroup_id ?? ''),
      externalCampaignId: String(row.campaign_id ?? ''),
      name: row.ad_name ?? '',
      status: row.status ?? null,
      type: row.ad_format ?? null,
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
  creds: TikTokCreds,
  from: string,
  to: string,
): Promise<void> {
  const rows = await tiktokReport({
    advertiser_id: creds.advertiserId,
    report_type: 'BASIC',
    data_level: 'AUCTION_AD',
    dimensions: JSON.stringify(['ad_id', 'stat_time_day', 'campaign_id', 'adgroup_id']),
    metrics: JSON.stringify([
      'impressions', 'clicks', 'spend', 'reach',
      'conversion', 'ctr', 'cpc', 'cpm', 'frequency',
    ]),
    start_date: from,
    end_date: to,
  }, creds.accessToken)

  const existing = await db
    .select({ id: adInsights.id, externalAdId: adInsights.externalAdId, date: adInsights.date })
    .from(adInsights)
    .where(and(eq(adInsights.tenantId, tenantId), eq(adInsights.provider, 'tiktok_ads')))
  const existingMap = new Map(existing.map(r => [`${r.externalAdId}|${r.date}`, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const dims = row.dimensions ?? {}
    const m = row.metrics ?? {}

    const externalAdId = String(dims.ad_id ?? '')
    // TikTok returns stat_time_day as "YYYY-MM-DD 00:00:00"
    const date = String(dims.stat_time_day ?? '').slice(0, 10)
    if (!externalAdId || !date) continue

    const spend = Number(m.spend ?? 0)
    const conversions = Number(m.conversion ?? 0)

    const fields = {
      tenantId,
      provider: 'tiktok_ads' as const,
      externalAdId,
      externalAdsetId: String(dims.adgroup_id ?? ''),
      externalCampaignId: String(dims.campaign_id ?? ''),
      date,
      impressions: Number(m.impressions ?? 0),
      clicks: Number(m.clicks ?? 0),
      spend,
      reach: Number(m.reach ?? 0),
      conversions,
      conversionValue: 0,
      ctr: Number(m.ctr ?? 0),
      cpc: Number(m.cpc ?? 0),
      cpm: Number(m.cpm ?? 0),
      roas: 0,
      frequency: Number(m.frequency ?? 0),
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
