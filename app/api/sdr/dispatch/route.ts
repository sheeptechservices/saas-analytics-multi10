import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { requireRole } from '@/lib/auth-guard'

const SOURCE = 'sdr-n8n'

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireRole(['master', 'admin', 'manager'], session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  const [row] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let settings: Record<string, unknown> = {}
  if (row) {
    try { settings = JSON.parse(row.settings) } catch {}
  }

  const dispatchUrl =
    typeof settings.n8nDispatchUrl === 'string' && settings.n8nDispatchUrl
      ? settings.n8nDispatchUrl
      : null

  if (!dispatchUrl) {
    return NextResponse.json({ error: 'dispatch_url_nao_configurada' }, { status: 400 })
  }

  const dispatchSecret =
    typeof settings.n8nDispatchSecret === 'string' && settings.n8nDispatchSecret
      ? settings.n8nDispatchSecret
      : undefined

  const limiteDiario =
    typeof settings.limiteDiario === 'number' ? settings.limiteDiario : null

  const payload = {
    tenantId,
    triggeredAt: new Date().toISOString(),
    limiteDiario,
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (dispatchSecret) headers['Authorization'] = `Bearer ${dispatchSecret}`
    const res = await fetch(dispatchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    return NextResponse.json({ ok: res.ok, status: res.status })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sdr dispatch → n8n]', error)
    return NextResponse.json({ ok: false, error })
  }
}
