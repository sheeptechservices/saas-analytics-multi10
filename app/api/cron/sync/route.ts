import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dataSources, tenantModules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { runSync } from '@/lib/sync/runner'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const enabledRows = await db
    .select({ t: tenantModules.tenantId, k: tenantModules.moduleKey })
    .from(tenantModules)
    .where(eq(tenantModules.enabled, true))
  const enabled = new Set(enabledRows.map(r => `${r.t}:${r.k}`))

  const sources = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.status, 'connected'))

  const syncedAt = new Date().toISOString()
  const results: Array<{
    dataSourceId: string
    tenantId: string
    providerKey: string
    status: string
    counts?: object
    error?: string
  }> = []

  for (const ds of sources) {
    if (!enabled.has(`${ds.tenantId}:integration.sdr-source`)) {
      results.push({
        dataSourceId: ds.id,
        tenantId: ds.tenantId,
        providerKey: ds.providerKey,
        status: 'module_disabled',
      })
      continue
    }

    try {
      const result = await runSync(ds)
      results.push({
        dataSourceId: ds.id,
        tenantId: ds.tenantId,
        providerKey: ds.providerKey,
        status: result.status,
        counts: result.counts,
        error: result.error,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync] dataSource=${ds.id} tenant=${ds.tenantId}`, msg)
      results.push({
        dataSourceId: ds.id,
        tenantId: ds.tenantId,
        providerKey: ds.providerKey,
        status: 'error',
        error: msg,
      })
    }
  }

  return NextResponse.json({ ok: true, syncedAt, results })
}
