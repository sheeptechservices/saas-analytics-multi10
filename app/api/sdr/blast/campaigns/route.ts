// GET /api/sdr/blast/campaigns
//
// Reconciles delivery statuses for the tenant, then returns all blast campaigns
// with per-status recipient counts and creator name.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients, users } from '@/lib/db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { reconcile } from '@/lib/blast/reconcile'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // Reconcile all campaigns for this tenant before returning
  await reconcile(tenantId).catch(err => console.error('[blast campaigns reconcile]', err))

  const rows = await db
    .select({
      id:              blastCampaigns.id,
      template:        blastCampaigns.template,
      totalSolicitado: blastCampaigns.totalSolicitado,
      skipped:         blastCampaigns.skipped,
      started:         blastCampaigns.started,
      status:          blastCampaigns.status,
      createdAt:       blastCampaigns.createdAt,
      createdByName:   users.name,
      pendente:  sql<number>`SUM(CASE WHEN ${blastRecipients.status} = 'pendente'  THEN 1 ELSE 0 END)`,
      enviado:   sql<number>`SUM(CASE WHEN ${blastRecipients.status} = 'enviado'   THEN 1 ELSE 0 END)`,
      entregue:  sql<number>`SUM(CASE WHEN ${blastRecipients.status} = 'entregue'  THEN 1 ELSE 0 END)`,
      lido:      sql<number>`SUM(CASE WHEN ${blastRecipients.status} = 'lido'      THEN 1 ELSE 0 END)`,
      falhou:    sql<number>`SUM(CASE WHEN ${blastRecipients.status} = 'falhou'    THEN 1 ELSE 0 END)`,
    })
    .from(blastCampaigns)
    .leftJoin(users, eq(blastCampaigns.createdBy, users.id))
    .leftJoin(blastRecipients, eq(blastRecipients.campaignId, blastCampaigns.id))
    .where(eq(blastCampaigns.tenantId, tenantId))
    .groupBy(blastCampaigns.id)
    .orderBy(desc(blastCampaigns.createdAt))

  return NextResponse.json({ campaigns: rows.map(r => ({
    ...r,
    pendente: Number(r.pendente ?? 0),
    enviado:  Number(r.enviado  ?? 0),
    entregue: Number(r.entregue ?? 0),
    lido:     Number(r.lido     ?? 0),
    falhou:   Number(r.falhou   ?? 0),
  })) })
}
