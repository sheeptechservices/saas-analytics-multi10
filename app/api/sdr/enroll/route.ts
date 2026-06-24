// POST /api/sdr/enroll
//
// Envia leadIds ao webhook de enrollment do n8n, que é responsável por criar
// as lead_actions. A plataforma NÃO escreve no Postgres/Supabase.
//
// Body:     { leadIds: string[], fase?: string, agendarPara?: string }
// Response: { ok: boolean, status?: number, enrolled?: number, error?: string }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { requireRole } from '@/lib/auth-guard'

const SOURCE      = 'sdr-n8n'
const MAX_LEADS   = 100
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireRole(['master', 'admin', 'manager'], session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  let body: { leadIds?: unknown; fase?: unknown; agendarPara?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds deve ser um array não vazio' }, { status: 400 })
  }
  if (body.leadIds.length > MAX_LEADS) {
    return NextResponse.json({ error: `máximo de ${MAX_LEADS} leads por enrollment` }, { status: 400 })
  }

  // Filter to valid UUIDs — silently drop invalid entries
  const leadIds = (body.leadIds as unknown[])
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'nenhum leadId válido (UUID esperado)' }, { status: 400 })
  }

  const fase        = typeof body.fase === 'string' && body.fase ? body.fase : 'Template 1'
  const agendarPara = typeof body.agendarPara === 'string' && body.agendarPara ? body.agendarPara : undefined

  // Load enrollment URL + secret from campaign settings
  const [row] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let settings: Record<string, unknown> = {}
  if (row) {
    try { settings = JSON.parse(row.settings) } catch {}
  }

  const enrollUrl =
    typeof settings.n8nEnrollUrl === 'string' && settings.n8nEnrollUrl
      ? settings.n8nEnrollUrl
      : null

  if (!enrollUrl) {
    return NextResponse.json({ error: 'enroll_url_nao_configurada' }, { status: 400 })
  }

  const enrollSecret =
    typeof settings.n8nEnrollSecret === 'string' && settings.n8nEnrollSecret
      ? settings.n8nEnrollSecret
      : undefined

  const payload = { tenantId, leadIds, fase, ...(agendarPara ? { agendarPara } : {}) }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (enrollSecret) headers['Authorization'] = `Bearer ${enrollSecret}`

    const res = await fetch(enrollUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })

    // Try to extract enrolled count if n8n returns it
    let enrolled: number | undefined
    try {
      const data = await res.json() as Record<string, unknown>
      if (typeof data.enrolled === 'number') enrolled = data.enrolled
      else if (typeof data.count === 'number')    enrolled = data.count
      else if (Array.isArray(data.created))       enrolled = data.created.length
    } catch { /* n8n response not JSON or no count field */ }

    return NextResponse.json({ ok: res.ok, status: res.status, enrolled })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sdr enroll → n8n]', error)
    return NextResponse.json({ ok: false, error })
  }
}
