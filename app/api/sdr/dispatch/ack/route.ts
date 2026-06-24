// POST /api/sdr/dispatch/ack
//
// Called server-to-server by n8n after each drip send to record the YCloud messageId.
// Creates (or reuses) the day's campaign bucket (kind='campanha', id deterministic) and
// inserts the recipient as 'enviado'. Idempotent on messageId.
//
// Auth: Bearer token == campaignSettings.n8nDispatchSecret for the tenant (source 'sdr-n8n').
// No user session.
//
// Body:     { tenantId, leadId, messageId, phone?, firstName?, template?, messageBody? }
// Response: { ok:true } | { ok:true, duplicate:true } | 400 | 401 | 500

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients, campaignSettings } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const SOURCE = 'sdr-n8n'

// Deterministic day-bucket id: "${tenantId}:drip:${YYYYMMDD}" in America/Sao_Paulo timezone.
function dayBucketId(tenantId: string): string {
  const yyyymmdd = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // 'YYYY-MM-DD'
    .replace(/-/g, '')
  return `${tenantId}:drip:${yyyymmdd}`
}

export async function POST(req: NextRequest) {
  // ── Parse + validate body ─────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tenantId   = typeof body.tenantId   === 'string' && body.tenantId.trim()   ? body.tenantId.trim()   : null
  const leadId     = typeof body.leadId     === 'string' && body.leadId.trim()     ? body.leadId.trim()     : null
  const messageId  = typeof body.messageId  === 'string' && body.messageId.trim()  ? body.messageId.trim()  : null

  if (!tenantId || !leadId || !messageId) {
    return NextResponse.json({ error: 'tenantId, leadId e messageId são obrigatórios' }, { status: 400 })
  }

  const phone       = typeof body.phone       === 'string' ? body.phone.trim()       : ''
  const firstName   = typeof body.firstName   === 'string' ? body.firstName.trim()   : ''
  const template    = typeof body.template    === 'string' ? body.template.trim()    : null
  const messageBody = typeof body.messageBody === 'string' ? body.messageBody.trim() : ''

  // ── Auth: load n8nDispatchSecret for this tenant ──────────────────────────────
  const [csRow] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let dispatchSecret: string | null = null
  if (csRow) {
    try {
      const settings = JSON.parse(csRow.settings) as Record<string, unknown>
      dispatchSecret = typeof settings.n8nDispatchSecret === 'string' && settings.n8nDispatchSecret
        ? settings.n8nDispatchSecret
        : null
    } catch {}
  }

  if (!dispatchSecret) {
    // Missing config treated as auth failure — avoids tenantId enumeration
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!bearer || bearer !== dispatchSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── Idempotency: bail out if messageId already registered ─────────────────
    const [existing] = await db
      .select({ id: blastRecipients.id })
      .from(blastRecipients)
      .where(eq(blastRecipients.ycloudMessageId, messageId))
      .limit(1)

    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    // ── Find-or-create the day's campaign bucket ──────────────────────────────
    const campaignId = dayBucketId(tenantId)
    const now = new Date()

    await db
      .insert(blastCampaigns)
      .values({
        id:              campaignId,
        tenantId,
        kind:            'campanha',
        template:        'Campanha SDR',
        templateBody:    null,
        totalSolicitado: 0,
        skipped:         0,
        started:         0,
        status:          'enviando',
        createdBy:       null,
        createdAt:       now,
      })
      .onConflictDoNothing({ target: blastCampaigns.id })

    // ── Insert recipient as 'enviado' (messageId already known) ──────────────
    await db
      .insert(blastRecipients)
      .values({
        id:              randomUUID(),
        campaignId,
        leadId,
        phone,
        firstName,
        messageBody,
        template:        template ?? null,
        ycloudMessageId: messageId,
        status:          'enviado',
        createdAt:       now,
        lastStatusAt:    now,
      })

    // ── Increment campaign counters ───────────────────────────────────────────
    await db
      .update(blastCampaigns)
      .set({
        totalSolicitado: sql`${blastCampaigns.totalSolicitado} + 1`,
        started:         sql`${blastCampaigns.started} + 1`,
      })
      .where(eq(blastCampaigns.id, campaignId))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[dispatch/ack]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
