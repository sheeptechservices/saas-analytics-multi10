import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { leads, stages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const DAY = 86_400_000

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') ?? 'all') as 'all' | '7d' | '30d' | '90d'

  const now = new Date()
  const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
  const days = PERIOD_DAYS[period] ?? null
  const periodStart = days ? new Date(now.getTime() - days * DAY) : null

  const allLeads = await db
    .select({
      id: leads.id,
      price: leads.price,
      responsibleName: leads.responsibleName,
      createdAt: leads.createdAt,
      stageKommoId: stages.kommoId,
    })
    .from(leads)
    .leftJoin(stages, eq(leads.stageId, stages.id))
    .where(eq(leads.tenantId, tenantId))

  const filtered = periodStart
    ? allLeads.filter(l => l.createdAt && new Date(l.createdAt) >= periodStart)
    : allLeads

  const repMap = new Map<string, {
    totalLeads: number
    wonLeads: number
    lostLeads: number
    activeLeads: number
    totalRevenue: number
  }>()

  for (const l of filtered) {
    const name = l.responsibleName?.trim() || ''
    if (!name) continue
    if (!repMap.has(name)) {
      repMap.set(name, { totalLeads: 0, wonLeads: 0, lostLeads: 0, activeLeads: 0, totalRevenue: 0 })
    }
    const rep = repMap.get(name)!
    rep.totalLeads++
    if (l.stageKommoId === '142') {
      rep.wonLeads++
      rep.totalRevenue += l.price ?? 0
    } else if (l.stageKommoId === '143') {
      rep.lostLeads++
    } else {
      rep.activeLeads++
    }
  }

  const reps = Array.from(repMap.entries()).map(([name, r]) => ({
    name,
    totalLeads: r.totalLeads,
    wonLeads: r.wonLeads,
    lostLeads: r.lostLeads,
    activeLeads: r.activeLeads,
    totalRevenue: r.totalRevenue,
    conversionRate: r.totalLeads > 0 ? Math.round((r.wonLeads / r.totalLeads) * 100) : 0,
    avgTicket: r.wonLeads > 0 ? Math.round(r.totalRevenue / r.wonLeads) : 0,
  }))

  reps.sort((a, b) => b.totalRevenue - a.totalRevenue)

  return NextResponse.json({ period, reps })
}
