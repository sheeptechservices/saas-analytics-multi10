import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenantModules } from '@/lib/db/schema'
import { NextResponse } from 'next/server'

/* Sem fallback, de propósito. Esta é a consulta que decide o que o cliente pode
 * ver: se ela falhar e devolvermos uma lista qualquer, ou abrimos módulo que o
 * cliente não contratou, ou escondemos o que ele contratou — e nos dois casos em
 * silêncio. Então ela estoura, e quem apara é a fronteira de erro (app/error.tsx),
 * que mostra "Tentar novamente". O oposto vale para marca e perfil
 * (lib/tenant.ts, lib/user.ts), que são enfeite e caem no padrão. */
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
