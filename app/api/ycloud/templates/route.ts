// GET /api/ycloud/templates
//
// Returns the full WhatsApp template list for this tenant's YCloud account.
// Response: { templates: WhatsappTemplate[] }
//
// Each template: { name, language, category?, status, components? }
// status includes 'approved' | 'rejected' | 'pending' — UI should filter.
// Requires module 'integration.ycloud-whatsapp'.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { yCloudProvider, listWhatsappTemplates } from '@/lib/providers/ycloud'

const PROVIDER_KEY = 'ycloud-whatsapp'
const MODULE_KEY   = 'integration.ycloud-whatsapp'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, MODULE_KEY)
  if (denied) return denied

  const row = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, PROVIDER_KEY),
    ))
    .then(r => r[0])

  if (!row?.configEnc) {
    return NextResponse.json({ error: 'integration_not_configured' }, { status: 404 })
  }

  let cfg: ReturnType<typeof yCloudProvider.parseConfig>
  try {
    cfg = yCloudProvider.parseConfig(JSON.parse(decrypt(row.configEnc)))
  } catch (err) {
    return NextResponse.json(
      { error: 'config_invalid', message: (err as Error).message },
      { status: 500 },
    )
  }

  try {
    const templates = await listWhatsappTemplates(cfg)
    return NextResponse.json({ templates })
  } catch (err) {
    return NextResponse.json(
      { error: 'ycloud_error', message: (err as Error).message },
      { status: 502 },
    )
  }
}
