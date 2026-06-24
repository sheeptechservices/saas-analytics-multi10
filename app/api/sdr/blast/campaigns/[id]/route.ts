// GET /api/sdr/blast/campaigns/[id]
//
// Reconciles a single campaign, then returns campaign header + per-recipient detail
// including error reason (pt-BR translated).

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { blastCampaigns, blastRecipients } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { reconcile } from '@/lib/blast/reconcile'

const ERROR_REASONS: Record<string, string> = {
  '131026': 'Número indisponível',
  '131008': 'Parâmetro ou template inválido',
  '131047': 'Fora da janela de 24 h',
}

function errorReason(code: string | null, msg: string | null): string | null {
  if (code && ERROR_REASONS[code]) return ERROR_REASONS[code]
  return msg || null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // Verify ownership
  const [campaign] = await db
    .select()
    .from(blastCampaigns)
    .where(and(eq(blastCampaigns.id, id), eq(blastCampaigns.tenantId, tenantId)))
    .limit(1)

  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Reconcile this campaign before returning
  await reconcile(tenantId, id).catch(err => console.error('[blast campaign detail reconcile]', err))

  const recipients = await db
    .select()
    .from(blastRecipients)
    .where(eq(blastRecipients.campaignId, id))
    .orderBy(asc(blastRecipients.createdAt))

  return NextResponse.json({
    campaign,
    recipients: recipients.map(r => ({
      id:             r.id,
      leadId:         r.leadId,
      phone:          r.phone,
      firstName:      r.firstName,
      status:         r.status,
      ycloudMessageId: r.ycloudMessageId,
      errorCode:      r.errorCode,
      errorReason:    errorReason(r.errorCode, r.errorMessage),
      lastStatusAt:   r.lastStatusAt,
    })),
  })
}
