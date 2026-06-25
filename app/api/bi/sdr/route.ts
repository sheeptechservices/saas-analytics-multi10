// GET /api/bi/sdr?period=30d|90d|180d|365d
//
// Response shape:
// {
//   period: string,
//   kpis:      { contatos, taxaResposta, reunioes, conversao },
//   funnel:    { stageKey, stageName, count, order }[],
//   sentiment: { id, label, color, count }[],   -- source='supabase-n8n' only
//   recent:    { sessionId, source, lastContact, msgs }[], -- top 50 across both sources
//   whatsapp:  {
//     totals: { sent, delivered, read, failed, inbound },
//     rates:  { entrega, leitura },              -- 0 when denominator is 0
//     daily:  { date:'YYYY-MM-DD', sent, delivered, read, failed, inbound }[],
//   },
//   lastSyncAt: number | null,
// }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { events, conversations, contacts, funnelSnapshots, dataSources } from '@/lib/db/schema'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'

const DAY = 86_400_000
const WA_LIMIT = 5_000

const PERIOD_DAYS: Record<string, number> = {
  '30d': 30, '90d': 90, '180d': 180, '365d': 365,
}

function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type WaBucket = { sent: number; delivered: number; read: number; failed: number; inbound: number }

function zeroBucket(): WaBucket {
  return { sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.dashboard')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? '30d'
  const days = PERIOD_DAYS[period] ?? 30

  const now = new Date()
  const periodStart = new Date(now.getTime() - days * DAY)
  const startMonth = toYearMonth(periodStart)
  const endMonth = toYearMonth(now)

  // Prior period of equal length for KPI trend comparison
  const priorStart = new Date(now.getTime() - 2 * days * DAY)
  const priorStartMonth = toYearMonth(priorStart)
  const priorEndMonth   = toYearMonth(periodStart)

  // ── Funnel snapshots: aggregate by stageKey over the period range ─────────
  const funnelRows = await db
    .select({
      stageKey:  funnelSnapshots.stageKey,
      stageName: funnelSnapshots.stageName,
      count:     sql<number>`sum(${funnelSnapshots.count})`,
      order:     sql<number>`min(${funnelSnapshots.order})`,
    })
    .from(funnelSnapshots)
    .where(and(
      eq(funnelSnapshots.tenantId, tenantId),
      eq(funnelSnapshots.source, 'supabase-n8n'),
      gte(funnelSnapshots.period, startMonth),
      lte(funnelSnapshots.period, endMonth),
    ))
    .groupBy(funnelSnapshots.stageKey, funnelSnapshots.stageName)
    .orderBy(sql`min(${funnelSnapshots.order})`)

  // ── Prior-period funnel snapshot (same shape, previous window) ────────────
  const priorFunnelRows = await db
    .select({
      stageKey: funnelSnapshots.stageKey,
      count:    sql<number>`sum(${funnelSnapshots.count})`,
    })
    .from(funnelSnapshots)
    .where(and(
      eq(funnelSnapshots.tenantId, tenantId),
      eq(funnelSnapshots.source, 'supabase-n8n'),
      gte(funnelSnapshots.period, priorStartMonth),
      lte(funnelSnapshots.period, priorEndMonth),
    ))
    .groupBy(funnelSnapshots.stageKey)

  // ── Events: sentiment (supabase-n8n only — YCloud events have null sentiment) ─
  const sentimentRows = await db
    .select({
      sentiment: events.sentiment,
      count:     sql<number>`count(*)`,
    })
    .from(events)
    .where(and(
      eq(events.tenantId, tenantId),
      eq(events.source, 'supabase-n8n'),
      gte(events.occurredAt, periodStart),
    ))
    .groupBy(events.sentiment)

  // ── Conversations: recent sessions from supabase-n8n (source of truth for n8n threads) ─
  //    ycloud-whatsapp is excluded — inbound messages from YCloud no longer write conversation
  //    rows; n8n_chat_histories (synced via supabase-n8n) is the canonical conversation store.
  //    occurredAt is mode:'timestamp' → Drizzle returns Date; .getTime() = epoch ms
  const convRows = await db
    .select({
      source:     conversations.source,
      sessionId:  conversations.sessionId,
      occurredAt: conversations.occurredAt,
    })
    .from(conversations)
    .where(and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.source, 'supabase-n8n'),
      gte(conversations.occurredAt, periodStart),
    ))
    .orderBy(desc(conversations.occurredAt))
    .limit(2000)

  // ── Data source for lastSyncAt ────────────────────────────────────────────
  const [ds] = await db
    .select({ lastSyncAt: dataSources.lastSyncAt, status: dataSources.status })
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, 'supabase-n8n'),
    ))
    .limit(1)

  // ── WhatsApp totals: exact SQL GROUP BY / COUNT — no row limit ───────────
  const yEvCountRows = await db
    .select({
      eventType: events.eventType,
      count:     sql<number>`count(*)`,
    })
    .from(events)
    .where(and(
      eq(events.tenantId, tenantId),
      eq(events.source, 'ycloud-whatsapp'),
      gte(events.occurredAt, periodStart),
    ))
    .groupBy(events.eventType)

  const [yConvCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.source, 'ycloud-whatsapp'),
      eq(conversations.role, 'human'),
      gte(conversations.occurredAt, periodStart),
    ))

  // ── WhatsApp daily series: row fetch for JS bucketisation (capped) ────────
  //    Totals come from the SQL aggregates above; these rows only power the chart.
  const yEvRows = await db
    .select({ eventType: events.eventType, occurredAt: events.occurredAt })
    .from(events)
    .where(and(
      eq(events.tenantId, tenantId),
      eq(events.source, 'ycloud-whatsapp'),
      gte(events.occurredAt, periodStart),
    ))
    .orderBy(desc(events.occurredAt))
    .limit(WA_LIMIT)

  if (yEvRows.length === WA_LIMIT) {
    console.warn(`[bi sdr whatsapp] série diária truncada em ${WA_LIMIT} linhas (events); totais permanecem exatos via SQL`)
  }

  const yConvRows = await db
    .select({ occurredAt: conversations.occurredAt })
    .from(conversations)
    .where(and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.source, 'ycloud-whatsapp'),
      eq(conversations.role, 'human'),
      gte(conversations.occurredAt, periodStart),
    ))
    .orderBy(desc(conversations.occurredAt))
    .limit(WA_LIMIT)

  if (yConvRows.length === WA_LIMIT) {
    console.warn(`[bi sdr whatsapp] série diária truncada em ${WA_LIMIT} linhas (conversations); totais permanecem exatos via SQL`)
  }

  // ── Derive KPIs from funnel ───────────────────────────────────────────────
  const funnelMap = new Map(funnelRows.map(r => [r.stageKey, Number(r.count)]))
  const leadsCount     = funnelMap.get('leads')     ?? 0
  const contactedCount = funnelMap.get('contacted') ?? 0
  const responsesCount = funnelMap.get('responses') ?? 0
  const meetingsCount  = funnelMap.get('meetings')  ?? 0

  const taxaResposta = contactedCount > 0
    ? Math.round((responsesCount / contactedCount) * 100) : 0
  const conversao = leadsCount > 0
    ? Math.round((meetingsCount / leadsCount) * 100) : 0

  // ── Prior-period KPIs and change computation ──────────────────────────────
  type Trend = 'up' | 'down' | 'flat'
  function trend(v: number): Trend { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat' }

  const priorMap = new Map(priorFunnelRows.map(r => [r.stageKey, Number(r.count)]))
  const priorLeads     = priorMap.get('leads')     ?? 0
  const priorContacted = priorMap.get('contacted') ?? 0
  const priorResponses = priorMap.get('responses') ?? 0
  const priorMeetings  = priorMap.get('meetings')  ?? 0

  const priorTaxaResposta = priorContacted > 0
    ? Math.round((priorResponses / priorContacted) * 100) : 0
  const priorConversao = priorLeads > 0
    ? Math.round((priorMeetings / priorLeads) * 100) : 0

  const kpisChange = {
    // Counts → % change; null when prior is 0 (no base for comparison)
    contatos: priorContacted > 0
      ? (() => { const pct = Math.round(((contactedCount - priorContacted) / priorContacted) * 100); return { pct, trend: trend(pct) } })()
      : null,
    reunioes: priorMeetings > 0
      ? (() => { const pct = Math.round(((meetingsCount - priorMeetings) / priorMeetings) * 100); return { pct, trend: trend(pct) } })()
      : null,
    // Rates → pp diff; null when prior denominator was 0 (rate is not meaningful)
    taxaResposta: priorContacted > 0
      ? (() => { const pp = taxaResposta - priorTaxaResposta; return { pp, trend: trend(pp) } })()
      : null,
    conversao: priorLeads > 0
      ? (() => { const pp = conversao - priorConversao; return { pp, trend: trend(pp) } })()
      : null,
  }

  // ── Sentiment donut ───────────────────────────────────────────────────────
  const sentMap = new Map<string, number>()
  for (const r of sentimentRows) {
    const key = r.sentiment ?? 'unknown'
    sentMap.set(key, (sentMap.get(key) ?? 0) + Number(r.count))
  }
  const sentiment = [
    { id: 'positive', label: 'Positivo',    color: '#1E8A3E', count: sentMap.get('positive') ?? 0 },
    { id: 'neutral',  label: 'Neutro',      color: '#FFB400', count: sentMap.get('neutral')  ?? 0 },
    { id: 'negative', label: 'Negativo',    color: '#D93025', count: sentMap.get('negative') ?? 0 },
    { id: 'unknown',  label: 'Sem análise', color: '#AAAAAA', count: sentMap.get('unknown')  ?? 0 },
  ].filter(s => s.count > 0)

  // ── Recent sessions: dedup by (source, sessionId); top 50 by recência ────
  //    Key = `${source}:${sessionId}` so same phone in YCloud and SDR don't collapse
  const sessionMap = new Map<string, { source: string; sessionId: string; lastContact: number | null; msgs: number }>()
  for (const row of convRows) {
    const key = `${row.source}:${row.sessionId}`
    const ms  = row.occurredAt instanceof Date ? row.occurredAt.getTime() : null
    const ex  = sessionMap.get(key)
    if (!ex) {
      sessionMap.set(key, { source: row.source, sessionId: row.sessionId, lastContact: ms, msgs: 1 })
    } else {
      ex.msgs++
      if (ms && (!ex.lastContact || ms > ex.lastContact)) ex.lastContact = ms
    }
  }
  const recent = Array.from(sessionMap.values())
    .sort((a, b) => (b.lastContact ?? 0) - (a.lastContact ?? 0))
    .slice(0, 50)
    .map(({ source, sessionId, lastContact, msgs }) => ({ sessionId, source, lastContact, msgs }))

  // ── Name lookup: match recent sessionIds against contacts ─────────────────
  // supabase-n8n sessionIds are plain digits (no '+'); YCloud contacts store
  // externalId as E.164 (with '+'). Query both forms and resolve via fallback.
  const recentIds = recent.map(r => r.sessionId)
  const allContactIds = Array.from(new Set([
    ...recentIds,
    ...recentIds.map(id => id.startsWith('+') ? id : '+' + id),
  ]))

  const contactRows = allContactIds.length > 0
    ? await db
        .select({ externalId: contacts.externalId, name: contacts.name })
        .from(contacts)
        .where(and(
          eq(contacts.tenantId, tenantId),
          inArray(contacts.externalId, allContactIds),
        ))
    : []

  const contactNameMap = new Map(contactRows.map(c => [c.externalId, c.name]))

  const recentWithName = recent.map(r => ({
    ...r,
    name: contactNameMap.get(r.sessionId)
      ?? contactNameMap.get('+' + r.sessionId)
      ?? null,
  }))

  // ── WhatsApp metrics ──────────────────────────────────────────────────────
  //
  //  Totals: exact SQL aggregates (no row limit — always correct).
  //  Daily series: JS bucketisation over the capped row fetch (chart only).
  //  occurredAt is mode:'timestamp' → Drizzle returns Date; .getTime() = epoch ms.
  //  Local-time bucket (toYMD) matches toYearMonth convention; avoids SQLite
  //  date() UTC ambiguity — same pattern as /api/bi leadsPerWeek.

  const evCountMap = new Map(yEvCountRows.map(r => [r.eventType, Number(r.count)]))
  const waTotals: WaBucket = {
    sent:      evCountMap.get('whatsapp_status_sent')      ?? 0,
    delivered: evCountMap.get('whatsapp_status_delivered') ?? 0,
    read:      evCountMap.get('whatsapp_status_read')      ?? 0,
    failed:    evCountMap.get('whatsapp_status_failed')    ?? 0,
    inbound:   Number(yConvCountRow?.count ?? 0),
  }

  // Daily series — bucketise the (possibly capped) row fetches in JS
  const waDailyMap = new Map<string, WaBucket>()

  for (const row of yEvRows) {
    if (!(row.occurredAt instanceof Date)) continue
    const day = toYMD(row.occurredAt)
    if (!waDailyMap.has(day)) waDailyMap.set(day, zeroBucket())
    const b = waDailyMap.get(day)!
    switch (row.eventType) {
      case 'whatsapp_status_sent':      b.sent++;      break
      case 'whatsapp_status_delivered': b.delivered++; break
      case 'whatsapp_status_read':      b.read++;      break
      case 'whatsapp_status_failed':    b.failed++;    break
    }
  }

  for (const row of yConvRows) {
    if (!(row.occurredAt instanceof Date)) continue
    const day = toYMD(row.occurredAt)
    if (!waDailyMap.has(day)) waDailyMap.set(day, zeroBucket())
    waDailyMap.get(day)!.inbound++
  }

  const waRates = {
    entrega: waTotals.sent      > 0 ? waTotals.delivered / waTotals.sent      : 0,
    leitura: waTotals.delivered > 0 ? waTotals.read      / waTotals.delivered : 0,
  }
  const waDaily = Array.from(waDailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, c]) => ({ date, ...c }))

  const lastSyncAtMs = ds?.lastSyncAt instanceof Date
    ? ds.lastSyncAt.getTime()
    : typeof ds?.lastSyncAt === 'number' ? ds.lastSyncAt : null

  const sourceConfigured = ds?.status === 'connected'

  return NextResponse.json({
    period,
    kpis: { contatos: contactedCount, taxaResposta, reunioes: meetingsCount, conversao },
    kpisChange,
    funnel: funnelRows.map(r => ({
      stageKey:  r.stageKey,
      stageName: r.stageName,
      count:     Number(r.count),
      order:     Number(r.order),
    })),
    sentiment,
    recent: recentWithName,
    sourceConfigured,
    whatsapp: {
      totals: waTotals,
      rates:  waRates,
      daily:  waDaily,
    },
    lastSyncAt: lastSyncAtMs,
  })
}
