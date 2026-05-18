import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { aiSettings, aiUsageLogs } from '@/lib/db/schema'
import { eq, and, gte } from 'drizzle-orm'

function periodStart(period: string): number {
  const now = new Date()
  if (period === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  }
  if (period === 'week') {
    return now.getTime() - 7 * 24 * 60 * 60 * 1000
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

async function fetchFxRate(): Promise<number> {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    const parsed = parseFloat((data as any).USDBRL?.bid ?? '0')
    if (parsed > 0) return parsed
  } catch {}
  return 6.0
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const period = req.nextUrl.searchParams.get('period') ?? 'month'
  const startMs = periodStart(period)

  const [settings, logs, exchangeRate] = await Promise.all([
    db.select().from(aiSettings)
      .where(eq(aiSettings.tenantId, session.user.tenantId))
      .then(r => r[0] ?? null),
    db.select().from(aiUsageLogs)
      .where(and(
        eq(aiUsageLogs.tenantId, session.user.tenantId),
        gte(aiUsageLogs.createdAt, startMs),
      )),
    fetchFxRate(),
  ])

  const totalUsd = logs.reduce((s, l) => s + l.costUsd, 0)
  const totalInputTokens = logs.reduce((s, l) => s + l.inputTokens, 0)
  const totalOutputTokens = logs.reduce((s, l) => s + l.outputTokens, 0)
  const callCount = logs.length
  const totalBrl = totalUsd * exchangeRate

  const byModel: Record<string, { costUsd: number; calls: number }> = {}
  const dailyMap = new Map<string, number>()

  for (const log of logs) {
    if (!byModel[log.model]) byModel[log.model] = { costUsd: 0, calls: 0 }
    byModel[log.model].costUsd += log.costUsd
    byModel[log.model].calls++
    const date = new Date(log.createdAt).toISOString().slice(0, 10)
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + log.costUsd)
  }

  const dailySeries = Array.from(dailyMap.entries())
    .map(([date, costUsd]) => ({ date, costUsd }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const budgetBrl = settings?.monthlyBudgetBrl ?? 0
  const monthlySpendUsd = settings?.cachedSpendUsd ?? 0
  const monthlySpendBrl = monthlySpendUsd * exchangeRate
  const budgetUsedPercent = budgetBrl > 0
    ? Math.min(100, (monthlySpendBrl / budgetBrl) * 100)
    : null

  return NextResponse.json({
    totalUsd,
    totalBrl,
    totalInputTokens,
    totalOutputTokens,
    callCount,
    budgetBrl,
    budgetUsedPercent,
    monthlySpendBrl,
    exchangeRate,
    byModel,
    dailySeries,
  })
}
