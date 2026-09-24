// GET /api/sdr/blast/campaigns[?kind=manual|campanha]
//
// Reconciles delivery statuses for the tenant, then returns blast campaigns
// with per-status recipient counts and creator name.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { assertEntitlement } from '@/lib/entitlements'
import { reconcile } from '@/lib/blast/reconcile'
import { listarCampanhas } from '@/lib/blast/campanhas'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  const kindFilter = req.nextUrl.searchParams.get('kind') ?? null
  const validKind = kindFilter === 'manual' || kindFilter === 'campanha' ? kindFilter : null

  // Reconcile all campaigns for this tenant before returning
  await reconcile(tenantId).catch(err => console.error('[blast campaigns reconcile]', err))

  const rows = await listarCampanhas(tenantId, validKind)

  return NextResponse.json({
    campaigns: rows.map(r => ({
      ...r,
      pendente: Number(r.pendente ?? 0),
      enviado:  Number(r.enviado  ?? 0),
      entregue: Number(r.entregue ?? 0),
      lido:     Number(r.lido     ?? 0),
      falhou:   Number(r.falhou   ?? 0),
    })),
  })
}
