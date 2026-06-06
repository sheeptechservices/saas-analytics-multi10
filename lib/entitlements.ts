import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenantModules } from '@/lib/db/schema'
import { NextResponse } from 'next/server'

export const getEnabledModuleKeys = cache(async (tenantId: string): Promise<string[]> => {
  if (!tenantId) return []
  const rows = await db
    .select({ key: tenantModules.moduleKey })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)))
  return rows.map(r => r.key)
})

export async function isModuleEnabled(tenantId: string, key: string): Promise<boolean> {
  const keys = await getEnabledModuleKeys(tenantId)
  return keys.includes(key)
}

export async function assertEntitlement(tenantId: string, key: string): Promise<NextResponse | null> {
  const ok = await isModuleEnabled(tenantId, key)
  if (!ok) return NextResponse.json({ error: 'module_disabled', module: key }, { status: 403 })
  return null
}
