// lib/blast/reconcile.ts
//
// Demand-driven reconciliation: reads whatsapp_status_* events from `events` (Turso),
// matches them to blast_recipients by ycloudMessageId, advances recipient statuses, and
// recalculates campaign counters. Writes only to Turso — never to Supabase.
//
// Status rank (higher = better/further):  lido(4) > entregue(3) > enviado(2) > falhou(1)
// 'lido' is the highest positive state and is never downgraded.

import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients, events } from '@/lib/db/schema'
import { and, eq, inArray, not, sql } from 'drizzle-orm'

type RecipientStatus = 'pendente' | 'enviado' | 'entregue' | 'lido' | 'falhou'

interface EventMapping {
  status: RecipientStatus
  rank:   number
}

const EVENT_MAP: Record<string, EventMapping> = {
  whatsapp_status_sent:      { status: 'enviado',  rank: 2 },
  whatsapp_status_delivered: { status: 'entregue', rank: 3 },
  whatsapp_status_read:      { status: 'lido',     rank: 4 },
  whatsapp_status_failed:    { status: 'falhou',   rank: 1 },
}

const STATUS_RANK: Record<string, number> = {
  pendente: 0, falhou: 1, enviado: 2, entregue: 3, lido: 4,
}

/**
 * Reconcile blast delivery statuses for a tenant. Pass campaignId to scope
 * reconciliation to a single campaign (faster for the detail view).
 */
export async function reconcile(tenantId: string, campaignId?: string) {
  // ── 1. Get recipients that can still be promoted (lido is the only terminal positive) ──
  const recipientRows = await db
    .select({
      id:             blastRecipients.id,
      campaignId:     blastRecipients.campaignId,
      ycloudMessageId: blastRecipients.ycloudMessageId,
      currentStatus:  blastRecipients.status,
    })
    .from(blastRecipients)
    .innerJoin(blastCampaigns, eq(blastRecipients.campaignId, blastCampaigns.id))
    .where(and(
      eq(blastCampaigns.tenantId, tenantId),
      campaignId ? eq(blastRecipients.campaignId, campaignId) : undefined,
      not(eq(blastRecipients.status, 'lido')), // lido is final — skip
    ))

  if (recipientRows.length === 0) return

  const msgIds = [
    ...new Set(
      recipientRows.map(r => r.ycloudMessageId).filter((v): v is string => Boolean(v)),
    ),
  ]
  if (msgIds.length === 0) return

  // ── 2. Fetch matching whatsapp_status_* events from Turso ─────────────────────
  const msgIdSql = sql.join(msgIds.map(id => sql`${id}`), sql`, `)
  const eventRows = await db
    .select({ payload: events.payload, eventType: events.eventType })
    .from(events)
    .where(and(
      eq(events.tenantId, tenantId),
      inArray(events.eventType, [
        'whatsapp_status_sent',
        'whatsapp_status_delivered',
        'whatsapp_status_read',
        'whatsapp_status_failed',
      ]),
      sql`json_extract(${events.payload}, '$.messageId') IN (${msgIdSql})`,
    ))

  // ── 3. Compute best status per messageId ──────────────────────────────────────
  const bestByMsgId = new Map<string, {
    status:       RecipientStatus
    rank:         number
    errorCode:    string | null
    errorMessage: string | null
  }>()

  for (const ev of eventRows) {
    const mapped = EVENT_MAP[ev.eventType]
    if (!mapped) continue
    let payload: Record<string, unknown> = {}
    try { payload = JSON.parse(ev.payload) } catch {}
    const msgId = typeof payload.messageId === 'string' ? payload.messageId : null
    if (!msgId) continue

    const existing = bestByMsgId.get(msgId)
    if (!existing || mapped.rank > existing.rank) {
      bestByMsgId.set(msgId, {
        status:       mapped.status,
        rank:         mapped.rank,
        errorCode:    mapped.status === 'falhou'
          ? (typeof payload.errorCode === 'string' ? payload.errorCode : null)
          : null,
        errorMessage: mapped.status === 'falhou'
          ? (typeof payload.errorMessage === 'string' ? payload.errorMessage : null)
          : null,
      })
    }
  }

  // ── 4. Update recipients that have a better status available ──────────────────
  const now = new Date()
  await Promise.all(
    recipientRows
      .filter(r => r.ycloudMessageId && bestByMsgId.has(r.ycloudMessageId))
      .map(async r => {
        const best = bestByMsgId.get(r.ycloudMessageId!)!
        const currentRank = STATUS_RANK[r.currentStatus] ?? 0
        if (best.rank <= currentRank) return // already at or past this level
        await db
          .update(blastRecipients)
          .set({
            status:       best.status,
            errorCode:    best.status === 'falhou' ? best.errorCode    : null,
            errorMessage: best.status === 'falhou' ? best.errorMessage : null,
            lastStatusAt: now,
          })
          .where(eq(blastRecipients.id, r.id))
      }),
  )

  // ── 5. Recalculate campaign header counters ───────────────────────────────────
  const affectedCampaignIds = [...new Set(recipientRows.map(r => r.campaignId))]
  await Promise.all(affectedCampaignIds.map(async cId => {
    const counts = await db
      .select({ status: blastRecipients.status, n: sql<number>`count(*)` })
      .from(blastRecipients)
      .where(eq(blastRecipients.campaignId, cId))
      .groupBy(blastRecipients.status)

    const byStatus = Object.fromEntries(counts.map(c => [c.status, Number(c.n)]))
    const pending  = (byStatus.pendente ?? 0) + (byStatus.enviado ?? 0)
    const started  = (byStatus.enviado  ?? 0) + (byStatus.entregue ?? 0)
                   + (byStatus.lido     ?? 0) + (byStatus.falhou   ?? 0)

    await db
      .update(blastCampaigns)
      .set({ status: pending > 0 ? 'enviando' : 'concluido', started })
      .where(eq(blastCampaigns.id, cId))
  }))
}
