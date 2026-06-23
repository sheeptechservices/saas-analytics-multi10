import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'

export type TenantBranding = { primaryColor: string; logoUrl: string | null; brandName: string }

export const getTenantBranding = cache(async (tenantId: string): Promise<TenantBranding> => {
  const fallback: TenantBranding = { primaryColor: '#E10504', logoUrl: null, brandName: '300 Franchising' }
  if (!tenantId) return fallback
  const t = await db
    .select({ name: tenants.name, primaryColor: tenants.primaryColor, logoUrl: tenants.logoUrl })
    .from(tenants).where(eq(tenants.id, tenantId)).then(r => r[0])
  if (!t) return fallback
  return { primaryColor: t.primaryColor ?? '#E10504', logoUrl: t.logoUrl ?? null, brandName: t.name }
})
