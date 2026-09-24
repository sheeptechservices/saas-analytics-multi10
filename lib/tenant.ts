import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { comFallback } from '@/lib/db/fallback'

export type TenantBranding = { primaryColor: string; logoUrl: string | null; brandName: string }

export const BRANDING_PADRAO: TenantBranding = { primaryColor: '#E10504', logoUrl: null, brandName: '300 Franchising' }

async function consultarBranding(tenantId: string): Promise<TenantBranding> {
  const t = await db
    .select({ name: tenants.name, primaryColor: tenants.primaryColor, logoUrl: tenants.logoUrl })
    .from(tenants).where(eq(tenants.id, tenantId)).then(r => r[0])
  if (!t) return BRANDING_PADRAO
  return { primaryColor: t.primaryColor ?? BRANDING_PADRAO.primaryColor, logoUrl: t.logoUrl ?? null, brandName: t.name }
}

/* Marca é enfeite: cor, logo e nome. Um soluço no banco não pode custar
 * a tela inteira por causa deles — cai no padrão e a navegação segue. O oposto
 * vale para getEnabledModuleKeys (lib/entitlements.ts), que decide o que o
 * cliente pode ver e por isso continua falhando alto. */
export const getTenantBranding = cache((tenantId: string): Promise<TenantBranding> =>
  tenantId
    ? comFallback(() => consultarBranding(tenantId), BRANDING_PADRAO, 'tenant')
    : Promise.resolve(BRANDING_PADRAO))
