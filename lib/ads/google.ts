import { db } from '@/lib/db'
import { integrations, adCampaigns, adAdsets, adAds, adInsights } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

// ─── Credentials ───────────────────────────────────────────────────────────────

interface GoogleCreds {
  integrationId: string
  customerId: string       // stripped of dashes
  developerToken: string   // decrypted accountDomain
  clientId: string
  clientSecret: string
  refreshToken: string
}

async function getCreds(tenantId: string): Promise<GoogleCreds> {
  const row = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, 'google_ads')))
    .then(r => r[0])

  if (!row?.accountId || !row?.accountDomain || !row?.clientId || !row?.clientSecret || !row?.refreshToken) {
    throw new Error('Google Ads: credenciais incompletas')
  }

  return {
    integrationId: row.id,
    customerId: row.accountId.replace(/-/g, ''),
    developerToken: decrypt(row.accountDomain),
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecret),
    refreshToken: decrypt(row.refreshToken),
  }
}

// ─── OAuth ─────────────────────────────────────────────────────────────────────

async function getAccessToken(creds: GoogleCreds): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Google OAuth falhou: ${res.status} ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.access_token as string
}

// ─── GAQL search (paginated) ───────────────────────────────────────────────────

type GaqlHeaders = Record<string, string>

async function gaqlSearch(cid: string, query: string, headers: GaqlHeaders): Promise<any[]> {
  const results: any[] = []
  let pageToken: string | undefined

  while (true) {
    const body: Record<string, any> = { query: query.trim(), pageSize: 1000 }
    if (pageToken) body.pageToken = pageToken

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${cid}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify(body) },
    )
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Google Ads API: ${res.status} ${txt.slice(0, 300)}`)
    }
    const data = await res.json()
    results.push(...(data.results ?? []))
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
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

async function syncCampaigns(tenantId: string, cid: string, headers: GaqlHeaders): Promise<void> {
  const rows = await gaqlSearch(cid, `
    SELECT campaign.id, campaign.name, campaign.status,
           campaign.advertising_channel_type,
           campaign.start_date, campaign.end_date
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `, headers)

  const existing = await db
    .select({ id: adCampaigns.id, externalId: adCampaigns.externalId })
    .from(adCampaigns)
    .where(and(eq(adCampaigns.tenantId, tenantId), eq(adCampaigns.provider, 'google_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.campaign?.id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'google_ads' as const,
      externalId,
      name: row.campaign?.name ?? '',
      status: row.campaign?.status ?? null,
      objective: row.campaign?.advertisingChannelType ?? null,
      dailyBudget: null,
      lifetimeBudget: null,
      currency: null,
      startDate: row.campaign?.startDate ?? null,
      endDate: row.campaign?.endDate ?? null,
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

async function syncAdsets(tenantId: string, cid: string, headers: GaqlHeaders): Promise<void> {
  const rows = await gaqlSearch(cid, `
    SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
  `, headers)

  const existing = await db
    .select({ id: adAdsets.id, externalId: adAdsets.externalId })
    .from(adAdsets)
    .where(and(eq(adAdsets.tenantId, tenantId), eq(adAdsets.provider, 'google_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.adGroup?.id ?? '')
    const externalCampaignId = String(row.campaign?.id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'google_ads' as const,
      externalId,
      externalCampaignId,
      name: row.adGroup?.name ?? '',
      status: row.adGroup?.status ?? null,
      dailyBudget: null,
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

async function syncAds(tenantId: string, cid: string, headers: GaqlHeaders): Promise<void> {
  const rows = await gaqlSearch(cid, `
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
           ad_group_ad.status, ad_group.id, campaign.id
    FROM ad_group_ad
    WHERE ad_group_ad.status != 'REMOVED'
  `, headers)

  const existing = await db
    .select({ id: adAds.id, externalId: adAds.externalId })
    .from(adAds)
    .where(and(eq(adAds.tenantId, tenantId), eq(adAds.provider, 'google_ads')))
  const existingMap = new Map(existing.map(r => [r.externalId, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalId = String(row.adGroupAd?.ad?.id ?? '')
    const externalAdsetId = String(row.adGroup?.id ?? '')
    const externalCampaignId = String(row.campaign?.id ?? '')
    if (!externalId) continue

    const fields = {
      tenantId,
      provider: 'google_ads' as const,
      externalId,
      externalAdsetId,
      externalCampaignId,
      name: row.adGroupAd?.ad?.name ?? '',
      status: row.adGroupAd?.status ?? null,
      type: row.adGroupAd?.ad?.type ?? null,
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
  cid: string,
  headers: GaqlHeaders,
  from: string,
  to: string,
): Promise<void> {
  const rows = await gaqlSearch(cid, `
    SELECT segments.date,
           campaign.id, ad_group.id, ad_group_ad.ad.id,
           metrics.impressions, metrics.clicks, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value,
           metrics.ctr, metrics.average_cpc, metrics.average_cpm
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${from}' AND '${to}'
  `, headers)

  // Build map of existing insights for this tenant+provider in the date range
  const existing = await db
    .select({ id: adInsights.id, externalAdId: adInsights.externalAdId, date: adInsights.date })
    .from(adInsights)
    .where(and(eq(adInsights.tenantId, tenantId), eq(adInsights.provider, 'google_ads')))
  const existingMap = new Map(existing.map(r => [`${r.externalAdId}|${r.date}`, r.id]))

  const syncedAt = new Date().toISOString()
  for (const row of rows) {
    const externalAdId = String(row.adGroupAd?.ad?.id ?? '')
    const externalAdsetId = String(row.adGroup?.id ?? '')
    const externalCampaignId = String(row.campaign?.id ?? '')
    const date = row.segments?.date ?? ''
    if (!externalAdId || !date) continue

    const m = row.metrics ?? {}
    const spend = Number(m.costMicros ?? 0) / 1_000_000
    const conversionValue = Number(m.conversionsValue ?? 0)

    const fields = {
      tenantId,
      provider: 'google_ads' as const,
      externalAdId,
      externalAdsetId,
      externalCampaignId,
      date,
      impressions: Number(m.impressions ?? 0),
      clicks: Number(m.clicks ?? 0),
      spend,
      reach: 0,
      conversions: Number(m.conversions ?? 0),
      conversionValue,
      ctr: Number(m.ctr ?? 0),
      cpc: Number(m.averageCpc ?? 0) / 1_000_000,
      cpm: Number(m.averageCpm ?? 0) / 1_000_000,
      roas: spend > 0 ? conversionValue / spend : 0,
      frequency: 0,
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
  const accessToken = await getAccessToken(creds)
  const headers: GaqlHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': creds.developerToken,
    'Content-Type': 'application/json',
  }

  await syncCampaigns(tenantId, creds.customerId, headers)
  await syncAdsets(tenantId, creds.customerId, headers)
  await syncAds(tenantId, creds.customerId, headers)

  const endDate = new Date()
  const startDate = new Date()
  startDate.setFullYear(startDate.getFullYear() - 2)

  for (const { from, to } of monthBatches(startDate, endDate)) {
    await syncInsightsBatch(tenantId, creds.customerId, headers, from, to)
  }

  await db.update(integrations)
    .set({ lastSyncAt: new Date() })
    .where(eq(integrations.id, creds.integrationId))
}

export async function dailySync(tenantId: string): Promise<void> {
  const creds = await getCreds(tenantId)
  const accessToken = await getAccessToken(creds)
  const headers: GaqlHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': creds.developerToken,
    'Content-Type': 'application/json',
  }

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 2)

  await syncCampaigns(tenantId, creds.customerId, headers)
  await syncInsightsBatch(
    tenantId, creds.customerId, headers,
    startDate.toISOString().slice(0, 10),
    endDate.toISOString().slice(0, 10),
  )

  await db.update(integrations)
    .set({ lastSyncAt: new Date() })
    .where(eq(integrations.id, creds.integrationId))
}
