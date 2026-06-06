import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations, adInsights, adCampaigns } from '@/lib/db/schema'
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm'
import { getEnabledModuleKeys } from '@/lib/entitlements'
import { ADS_PROVIDER_MODULE } from '@/lib/modules'

const AD_PROVIDERS = ['google_ads', 'meta_ads', 'tiktok_ads'] as const
type AdProvider = typeof AD_PROVIDERS[number]

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  const modules = await getEnabledModuleKeys(tenantId)

  if (!modules.includes('dashboard.marketing')) {
    return NextResponse.json({ error: 'module_disabled' }, { status: 403 })
  }

  const enabledProviders = AD_PROVIDERS.filter(p => modules.includes(ADS_PROVIDER_MODULE[p]))

  if (enabledProviders.length === 0) {
    return NextResponse.json({
      hasIntegrations: false,
      totals: { totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0, totalConversionValue: 0, avgCtr: 0, avgCpc: 0, avgCpm: 0, avgRoas: 0 },
      timeSeries: [],
      byProvider: [],
      top10: [],
    })
  }

  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('startDate') ?? ''
  const endDate = searchParams.get('endDate') ?? ''
  const providerParam = searchParams.get('provider') ?? ''

  const activeProvider = AD_PROVIDERS.includes(providerParam as AdProvider)
    ? (providerParam as AdProvider)
    : null

  // ── hasIntegrations ──────────────────────────────────────────────────────────

  const integrationRows = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(
      eq(integrations.tenantId, tenantId),
      inArray(integrations.provider, [...enabledProviders]),
    ))
  const hasIntegrations = integrationRows.length > 0

  // ── Base filters ─────────────────────────────────────────────────────────────

  const filters = [
    eq(adInsights.tenantId, tenantId),
    inArray(adInsights.provider, [...enabledProviders]),
    ...(activeProvider ? [eq(adInsights.provider, activeProvider)] : []),
    ...(startDate ? [gte(adInsights.date, startDate)] : []),
    ...(endDate ? [lte(adInsights.date, endDate)] : []),
  ]

  // ── Totals ───────────────────────────────────────────────────────────────────

  const totalsRows = await db
    .select({
      totalSpend: sql<number>`COALESCE(SUM(${adInsights.spend}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${adInsights.impressions}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${adInsights.clicks}), 0)`,
      totalConversions: sql<number>`COALESCE(SUM(${adInsights.conversions}), 0)`,
      totalConversionValue: sql<number>`COALESCE(SUM(${adInsights.conversionValue}), 0)`,
    })
    .from(adInsights)
    .where(and(...filters))

  const t = totalsRows[0] ?? {
    totalSpend: 0, totalImpressions: 0, totalClicks: 0,
    totalConversions: 0, totalConversionValue: 0,
  }

  const avgCtr = t.totalImpressions > 0 ? (t.totalClicks / t.totalImpressions) * 100 : 0
  const avgCpc = t.totalClicks > 0 ? t.totalSpend / t.totalClicks : 0
  const avgCpm = t.totalImpressions > 0 ? (t.totalSpend / t.totalImpressions) * 1000 : 0
  const avgRoas = t.totalSpend > 0 ? t.totalConversionValue / t.totalSpend : 0

  const totals = {
    totalSpend: Number(t.totalSpend),
    totalImpressions: Number(t.totalImpressions),
    totalClicks: Number(t.totalClicks),
    totalConversions: Number(t.totalConversions),
    totalConversionValue: Number(t.totalConversionValue),
    avgCtr,
    avgCpc,
    avgCpm,
    avgRoas,
  }

  // ── Time series ──────────────────────────────────────────────────────────────

  const timeSeriesRows = await db
    .select({
      date: adInsights.date,
      provider: adInsights.provider,
      spend: sql<number>`COALESCE(SUM(${adInsights.spend}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${adInsights.impressions}), 0)`,
      clicks: sql<number>`COALESCE(SUM(${adInsights.clicks}), 0)`,
      conversionValue: sql<number>`COALESCE(SUM(${adInsights.conversionValue}), 0)`,
    })
    .from(adInsights)
    .where(and(...filters))
    .groupBy(adInsights.date, adInsights.provider)
    .orderBy(adInsights.date)

  const timeSeries = timeSeriesRows.map(r => ({
    date: r.date,
    provider: r.provider,
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    roas: Number(r.spend) > 0 ? Number(r.conversionValue) / Number(r.spend) : 0,
  }))

  // ── By provider ──────────────────────────────────────────────────────────────

  const byProviderRows = await db
    .select({
      provider: adInsights.provider,
      spend: sql<number>`COALESCE(SUM(${adInsights.spend}), 0)`,
      clicks: sql<number>`COALESCE(SUM(${adInsights.clicks}), 0)`,
      conversionValue: sql<number>`COALESCE(SUM(${adInsights.conversionValue}), 0)`,
    })
    .from(adInsights)
    .where(and(...filters))
    .groupBy(adInsights.provider)

  const byProvider = byProviderRows.map(r => ({
    provider: r.provider,
    spend: Number(r.spend),
    clicks: Number(r.clicks),
    roas: Number(r.spend) > 0 ? Number(r.conversionValue) / Number(r.spend) : 0,
  }))

  // ── Top 10 campaigns ─────────────────────────────────────────────────────────

  const top10Rows = await db
    .select({
      externalCampaignId: adInsights.externalCampaignId,
      provider: adInsights.provider,
      spend: sql<number>`COALESCE(SUM(${adInsights.spend}), 0)`,
      clicks: sql<number>`COALESCE(SUM(${adInsights.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${adInsights.impressions}), 0)`,
    })
    .from(adInsights)
    .where(and(...filters))
    .groupBy(adInsights.externalCampaignId, adInsights.provider)
    .orderBy(sql`SUM(${adInsights.spend}) DESC`)
    .limit(10)

  // Fetch campaign names
  const campaignIds = top10Rows.map(r => r.externalCampaignId).filter(Boolean)
  const campaignNames = campaignIds.length > 0
    ? await db
        .select({ externalId: adCampaigns.externalId, name: adCampaigns.name })
        .from(adCampaigns)
        .where(and(
          eq(adCampaigns.tenantId, tenantId),
          inArray(adCampaigns.externalId, campaignIds),
        ))
    : []
  const nameMap = new Map(campaignNames.map(r => [r.externalId, r.name]))

  const top10 = top10Rows.map(r => {
    const spend = Number(r.spend)
    const clicks = Number(r.clicks)
    const impressions = Number(r.impressions)
    return {
      name: nameMap.get(r.externalCampaignId) ?? r.externalCampaignId,
      provider: r.provider,
      spend,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      roas: 0,
    }
  })

  return NextResponse.json({ hasIntegrations, totals, timeSeries, byProvider, top10 })
}
