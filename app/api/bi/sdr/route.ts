import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { events, conversations, funnelSnapshots, dataSources } from '@/lib/db/schema'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'

const DAY = 86_400_000

const PERIOD_DAYS: Record<string, number> = {
  '30d': 30, '90d': 90, '180d': 180, '365d': 365,
}

function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

  // ── Funnel snapshots: aggregate by stageKey over the period range ────────
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

  // ── Events: sentiment distribution ──────────────────────────────────────
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

  // ── Conversations: recent sessions (por created_at → occurredAt) ─────────
  const convRows = await db
    .select({
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

  // ── Data source for lastSyncAt ───────────────────────────────────────────
  const [ds] = await db
    .select({ lastSyncAt: dataSources.lastSyncAt })
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, 'supabase-n8n'),
    ))
    .limit(1)

  // ── Derive KPIs from funnel ──────────────────────────────────────────────
  const funnelMap = new Map(funnelRows.map(r => [r.stageKey, Number(r.count)]))
  const leadsCount     = funnelMap.get('leads')     ?? 0
  const contactedCount = funnelMap.get('contacted') ?? 0
  const responsesCount = funnelMap.get('responses') ?? 0
  const meetingsCount  = funnelMap.get('meetings')  ?? 0

  const taxaResposta = contactedCount > 0
    ? Math.round((responsesCount / contactedCount) * 100) : 0
  const conversao = leadsCount > 0
    ? Math.round((meetingsCount / leadsCount) * 100) : 0

  // ── Sentiment donut ──────────────────────────────────────────────────────
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

  // ── Dedup por sessionId; recência = maior occurredAt da sessão ──────────
  const sessionMap = new Map<string, { lastContact: number | null; msgs: number }>()
  for (const row of convRows) {
    const ms = row.occurredAt instanceof Date ? row.occurredAt.getTime() : null
    const ex = sessionMap.get(row.sessionId)
    if (!ex) {
      sessionMap.set(row.sessionId, { lastContact: ms, msgs: 1 })
    } else {
      ex.msgs++
      if (ms && (!ex.lastContact || ms > ex.lastContact)) ex.lastContact = ms
    }
  }
  const recent = Array.from(sessionMap.entries())
    .sort((a, b) => (b[1].lastContact ?? 0) - (a[1].lastContact ?? 0))
    .slice(0, 50)
    .map(([sessionId, { lastContact, msgs }]) => ({ sessionId, lastContact, msgs }))

  const lastSyncAtMs = ds?.lastSyncAt instanceof Date
    ? ds.lastSyncAt.getTime()
    : typeof ds?.lastSyncAt === 'number' ? ds.lastSyncAt : null

  return NextResponse.json({
    period,
    kpis: { contatos: contactedCount, taxaResposta, reunioes: meetingsCount, conversao },
    funnel: funnelRows.map(r => ({
      stageKey:  r.stageKey,
      stageName: r.stageName,
      count:     Number(r.count),
      order:     Number(r.order),
    })),
    sentiment,
    recent,
    lastSyncAt: lastSyncAtMs,
  })
}
