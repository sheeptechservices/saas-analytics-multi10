// POST /api/sdr/blast/ack
//
// Called server-to-server by the automation (n8n) after each YCloud send to record the
// YCloud messageId for a blast recipient and advance its status to 'enviado'.
//
// No user session — authenticated via the same Bearer token stored in
// campaignSettings.n8nBlastSecret for the tenant.
//
// Body:     { tenantId: string, recipientId: string, messageId: string }
// Response: { ok: true } | { ok: true, matched: 0 } | 401 | 400 | 500

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients, campaignSettings } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const SOURCE = 'sdr-n8n'

export async function POST(req: NextRequest) {
  // ── Parse + validate body ─────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tenantId    = typeof body.tenantId    === 'string' && body.tenantId.trim()    ? body.tenantId.trim()    : null
  const recipientId = typeof body.recipientId === 'string' && body.recipientId.trim() ? body.recipientId.trim() : null
  const messageId   = typeof body.messageId   === 'string' && body.messageId.trim()   ? body.messageId.trim()   : null

  if (!tenantId || !recipientId || !messageId) {
    return NextResponse.json({ error: 'tenantId, recipientId e messageId são obrigatórios' }, { status: 400 })
  }

  // ── Load n8nBlastSecret for this tenant ───────────────────────────────────────
  const [csRow] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let blastSecret: string | null = null
  if (csRow) {
    try {
      const settings = JSON.parse(csRow.settings) as Record<string, unknown>
      blastSecret = typeof settings.n8nBlastSecret === 'string' && settings.n8nBlastSecret
        ? settings.n8nBlastSecret
        : null
    } catch {}
  }

  if (!blastSecret) {
    // Tenant not configured or no secret — treat as auth failure to avoid enumeration
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Verify Bearer token ───────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!bearer || bearer !== blastSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Verify ownership: recipient must belong to a campaign of this tenant ──────
  const [owned] = await db
    .select({ id: blastRecipients.id })
    .from(blastRecipients)
    .innerJoin(blastCampaigns, eq(blastRecipients.campaignId, blastCampaigns.id))
    .where(and(
      eq(blastRecipients.id, recipientId),
      eq(blastCampaigns.tenantId, tenantId),
    ))
    .limit(1)

  if (!owned) {
    // recipientId not found or belongs to another tenant — return 200 matched:0 (n8n-friendly)
    return NextResponse.json({ ok: true, matched: 0 })
  }

  // ── Update: record messageId and promote status pendente → enviado ────────────
  await db
    .update(blastRecipients)
    .set({
      ycloudMessageId: messageId,
      // Never demote a status that has already advanced past 'enviado'
      status: sql`CASE WHEN ${blastRecipients.status} = 'pendente' THEN 'enviado' ELSE ${blastRecipients.status} END`,
      lastStatusAt: new Date(),
    })
    .where(eq(blastRecipients.id, recipientId))

  return NextResponse.json({ ok: true })
}
