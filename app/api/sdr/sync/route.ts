// POST /api/sdr/sync
//
// On-demand sync for the authenticated tenant: runs runSync() on every connected
// data_source belonging to the tenant, skipping sources whose module is disabled.
// Mirrors the logic of /api/cron/sync but scoped to the session tenant.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources, tenantModules } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { runSync } from '@/lib/sync/runner'
import { getModuleKeyForProvider } from '@/lib/modules'

const MODULE_KEY = 'integration.ycloud-whatsapp'

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, MODULE_KEY)
  if (denied) return denied

  const enabledRows = await db
    .select({ k: tenantModules.moduleKey })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)))
  const enabledKeys = new Set(enabledRows.map(r => r.k))

  const sources = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.tenantId, tenantId), eq(dataSources.status, 'connected')))

  const syncedAt = new Date().toISOString()
  const results: Array<{
    providerKey: string
    status: string
    counts?: object
    error?: string
  }> = []

  for (const ds of sources) {
    const moduleKey = getModuleKeyForProvider(ds.providerKey)
    if (!moduleKey || !enabledKeys.has(moduleKey)) {
      results.push({ providerKey: ds.providerKey, status: 'module_disabled' })
      continue
    }

    try {
      const result = await runSync(ds)
      results.push({
        providerKey: ds.providerKey,
        status:      result.status,
        counts:      result.counts,
        error:       result.error,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sdr/sync] dataSource=${ds.id} tenant=${tenantId}`, msg)
      results.push({ providerKey: ds.providerKey, status: 'error', error: msg })
    }
  }

  return NextResponse.json({ ok: true, syncedAt, results })
}
