import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { leads, leadExtras, stages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { weekLabel } from '@/lib/utils'

const DAY = 86_400_000

function calcChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 100 : null
  return Math.round(((curr - prev) / prev) * 100)
}

function computeMetrics(list: any[], now: Date) {
  const closed = list.filter(l => l.stageKommoId === '142')
  const closedLeads = closed.length
  const conversionRate = list.length > 0 ? Math.round((closedLeads / list.length) * 100) : 0
  const averageTicket = closedLeads > 0 ? Math.round(closed.reduce((s: number, l: any) => s + l.price, 0) / closedLeads) : 0
  const weekAgo = new Date(now.getTime() - 7 * DAY)
  const leadsThisWeek = list.filter(l => l.createdAt && new Date(l.createdAt) >= weekAgo).length
  return { total: list.length, closedLeads, conversionRate, averageTicket, leadsThisWeek }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') ?? 'all') as 'all' | '7d' | '30d' | '90d'

  const now = new Date()

  // Period date ranges
  const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
  const days = PERIOD_DAYS[period] ?? null
  const periodStart = days ? new Date(now.getTime() - days * DAY) : null
  const prevStart  = days ? new Date(now.getTime() - days * 2 * DAY) : null
  const prevEnd    = periodStart

  // Fetch all leads with stage info
  const allLeads = await db
    .select({
      id: leads.id,
      stageId: leads.stageId,
      price: leads.price,
      name: leads.name,
      responsibleName: leads.responsibleName,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      stageName: stages.name,
      stageColor: stages.color,
      stageOrder: stages.order,
      stageKommoId: stages.kommoId,
      lossReason: leads.lossReason,
    })
    .from(leads)
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .where(eq(leads.tenantId, tenantId))

  const extrasData = await db
    .select({ leadId: leadExtras.leadId })
    .from(leadExtras)
    .where(eq(leadExtras.tenantId, tenantId))

  const extrasSet = new Set(extrasData.map(e => e.leadId))

  // Filter sets
  const periodLeads = periodStart
    ? allLeads.filter(l => l.createdAt && new Date(l.createdAt) >= periodStart)
    : allLeads

  const prevLeads = (prevStart && prevEnd)
    ? allLeads.filter(l => {
        const d = l.createdAt ? new Date(l.createdAt) : null
        return d && d >= prevStart && d < prevEnd
      })
    : null

  const curr = computeMetrics(periodLeads, now)
  const prev = prevLeads ? computeMetrics(prevLeads, now) : null

  // For 'all' mode: compare this week vs last week for leadsThisWeek
  const weekAgo     = new Date(now.getTime() - 7 * DAY)
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY)
  const lastWeekCount = allLeads.filter(l => {
    const d = l.createdAt ? new Date(l.createdAt) : null
    return d && d >= twoWeeksAgo && d < weekAgo
  }).length

  const changes = prev
    ? {
        totalLeads:     calcChange(curr.total,          prev.total),
        closedLeads:    calcChange(curr.closedLeads,    prev.closedLeads),
        conversionRate: calcChange(curr.conversionRate, prev.conversionRate),
        averageTicket:  calcChange(curr.averageTicket,  prev.averageTicket),
      }
    : {
        totalLeads:     null,
        closedLeads:    null,
        conversionRate: null,
        averageTicket:  null,
        leadsThisWeek:  calcChange(curr.leadsThisWeek, lastWeekCount),
      }

  // Stage distribution (based on filtered leads)
  const stageMap = new Map<string, { stageName: string; color: string; order: number; stageKommoId: string | null; count: number; total: number; timeSum: number; timeCount: number }>()
  for (const l of periodLeads) {
    if (!l.stageId) continue
    const days = l.createdAt && l.updatedAt
      ? Math.max(0, (new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / DAY)
      : 0
    const ex = stageMap.get(l.stageId)
    if (ex) { ex.count++; ex.total += l.price; ex.timeSum += days; ex.timeCount++ }
    else stageMap.set(l.stageId, { stageName: l.stageName ?? 'Sem etapa', color: l.stageColor ?? '#AAAAAA', order: l.stageOrder ?? 0, stageKommoId: l.stageKommoId ?? null, count: 1, total: l.price, timeSum: days, timeCount: 1 })
  }
  const leadsByStage = Array.from(stageMap.entries())
    .map(([stageId, v]) => ({
      stageId,
      stageName: v.stageName,
      color: v.color,
      order: v.order,
      stageKommoId: v.stageKommoId,
      count: v.count,
      total: v.total,
      avgLeadTimeDays: v.timeCount > 0 ? Math.round((v.timeSum / v.timeCount) * 10) / 10 : null,
    }))
    .sort((a, b) => a.order - b.order)

  // Status distribution: ganho / perdido / em negociação
  const isGanho   = (l: any) => l.stageKommoId === '142'
  const isPerdido = (l: any) => l.stageKommoId === '143'

  // Average lead time: closed leads in period (updatedAt - createdAt in days)
  const closedLeadsList = periodLeads.filter(l => isGanho(l) || isPerdido(l))
  const avgLeadTimeDays = closedLeadsList.length > 0
    ? Math.round(
        closedLeadsList.reduce((s, l) => {
          if (!l.createdAt || !l.updatedAt) return s
          return s + Math.max(0, (new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / DAY)
        }, 0) / closedLeadsList.length * 10
      ) / 10
    : null
  const ganhoCount   = periodLeads.filter(isGanho).length
  const perdidoCount = periodLeads.filter(isPerdido).length
  const negCount     = periodLeads.filter(l => !isGanho(l) && !isPerdido(l)).length
  const leadsByStatus = [
    { key: 'negociacao', label: 'Em negociação', color: '#FFB400', count: negCount },
    { key: 'ganho',      label: 'Ganho',          color: '#1E8A3E', count: ganhoCount },
    { key: 'perdido',    label: 'Perdido',         color: '#D93025', count: perdidoCount },
  ].filter(s => s.count > 0)

  // Leads per week (last 6 weeks, always from all leads for context)
  const leadsPerWeek = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now.getTime() - (i + 1) * 7 * DAY)
    const end   = new Date(now.getTime() - i * 7 * DAY)
    const count = allLeads.filter(l => {
      const d = l.createdAt ? new Date(l.createdAt) : null
      return d && d >= start && d < end
    }).length
    return { week: weekLabel(i), count }
  }).reverse()

  // Loss reasons (from "Perdido" leads in filtered period)
  const lostLeads = periodLeads.filter(isPerdido)
  const reasonMap = new Map<string, { count: number; value: number }>()
  for (const l of lostLeads) {
    const reason = l.lossReason ?? 'Não informado'
    const ex = reasonMap.get(reason)
    if (ex) { ex.count++; ex.value += l.price }
    else reasonMap.set(reason, { count: 1, value: l.price })
  }
  const lossReasons = Array.from(reasonMap.entries())
    .map(([reason, { count, value }]) => ({
      reason,
      count,
      value: Math.round(value),
      percentage: lostLeads.length > 0 ? Math.round((count / lostLeads.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // Leads by responsible (won / active / lost) from filtered period
  const repStatusMap = new Map<string, { won: number; active: number; lost: number }>()
  for (const l of periodLeads) {
    const name = l.responsibleName?.trim() || '—'
    if (!repStatusMap.has(name)) repStatusMap.set(name, { won: 0, active: 0, lost: 0 })
    const r = repStatusMap.get(name)!
    if (isGanho(l)) r.won++
    else if (isPerdido(l)) r.lost++
    else r.active++
  }
  const leadsByResponsible = Array.from(repStatusMap.entries())
    .map(([name, r]) => ({ name, won: r.won, active: r.active, lost: r.lost, total: r.won + r.active + r.lost }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)

  // Top leads from filtered set
  const topLeads = [...periodLeads]
    .sort((a, b) => b.price - a.price)
    .slice(0, 5)
    .map(l => ({ ...l, createdAt: l.createdAt ? new Date(l.createdAt) : new Date() }))

  const leadsWithExtras = periodLeads.filter(l => extrasSet.has(l.id)).length

  return NextResponse.json({
    period,
    totalLeads:     curr.total,
    closedLeads:    curr.closedLeads,
    leadsThisWeek:  curr.leadsThisWeek,
    conversionRate: curr.conversionRate,
    averageTicket:  curr.averageTicket,
    leadsByStage,
    leadsByStatus,
    leadsPerWeek,
    topLeads,
    lossReasons,
    leadsByResponsible,
    leadsWithExtras,
    totalLeadsAll:  allLeads.length,
    avgLeadTimeDays,
    changes,
  })
}
