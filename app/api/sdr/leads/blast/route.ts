// POST /api/sdr/leads/blast
//
// Dispara um template aprovado do WhatsApp para uma LISTA específica de leads
// (blast direto, fora da fila/campanha SDR). A app resolve os destinatários
// (telefone E.164 + first_name) e o remetente, e envia ao webhook n8nBlastUrl,
// que faz o envio via YCloud com throttle.
//
// REGRA CRÍTICA: a app NUNCA escreve no Supabase — apenas LÊ (leads + remetente).
// O envio é responsabilidade do n8n.
//
// Body:     { leadIds: string[], template: string, templateBody?: string, names?: Record<string,string> }
// Response: { ok, started, totalSolicitado, skipped }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { dataSources, campaignSettings, blastCampaigns, blastRecipients } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { requireRole } from '@/lib/auth-guard'
import { randomUUID } from 'crypto'
import { Client } from 'pg'

const PROVIDER_KEY      = 'supabase-n8n'
const SOURCE            = 'sdr-n8n'
const MAX_LEADS         = 1000
const DEFAULT_FIRST_NAME = 'tudo bem'
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const E164_RE      = /^\+[1-9]\d{6,14}$/

interface LeadRow {
  id:             string
  name:           string | null
  phone:          string | null
  phone_adjusted: string | null
}

// Normalize a lead's stored phone to E.164. Returns null when not usable.
function toE164(phone: string | null, phoneAdjusted: string | null): string | null {
  const raw = (phone ?? '').trim()
  if (raw.startsWith('+') && E164_RE.test(raw)) return raw
  const digits = (phoneAdjusted ?? phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  const e164 = '+' + digits
  return E164_RE.test(e164) ? e164 : null
}

// Render template body replacing all {{variable}} placeholders with firstName.
function renderMessage(templateBody: string, firstName: string): string {
  return String(templateBody ?? '').replace(/\{\{\s*[\w.]+\s*\}\}/g, firstName)
}

// Ensure BR mobile numbers have the 9th digit (DDD(2) + 9 + 8 digits = 11 national digits).
// Old leads may be stored without it (10 national digits). Landlines (1st digit 2-5) are
// left untouched. Non-BR numbers are returned as-is.
function ensureBr9(e164: string): string {
  if (!e164.startsWith('+55')) return e164
  const national = e164.slice(3) // remove '+55'
  if (national.length !== 10) return e164
  const firstDigit = national[2] // 1st digit after DDD
  if (firstDigit < '6') return e164 // landline (2-5) or already impossible — skip
  return '+55' + national.slice(0, 2) + '9' + national.slice(2)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireRole(['master', 'admin', 'manager'], session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  let body: { leadIds?: unknown; template?: unknown; names?: unknown; templateBody?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const template     = typeof body.template     === 'string' ? body.template.trim()     : ''
  const templateBody = typeof body.templateBody === 'string' ? body.templateBody        : ''
  if (!template) {
    return NextResponse.json({ error: 'template é obrigatório' }, { status: 400 })
  }

  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds deve ser um array não vazio' }, { status: 400 })
  }
  if (body.leadIds.length > MAX_LEADS) {
    return NextResponse.json({ error: `máximo de ${MAX_LEADS} leads por disparo` }, { status: 400 })
  }

  const leadIds = (body.leadIds as unknown[])
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'nenhum leadId válido (UUID esperado)' }, { status: 400 })
  }

  const names: Record<string, string> =
    body.names !== null && typeof body.names === 'object' && !Array.isArray(body.names)
      ? (body.names as Record<string, string>)
      : {}

  // ── Load n8nBlastUrl + secret from campaign settings ──────────────────────────
  const [csRow] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let csSettings: Record<string, unknown> = {}
  if (csRow) {
    try { csSettings = JSON.parse(csRow.settings) } catch {}
  }

  const blastUrl =
    typeof csSettings.n8nBlastUrl === 'string' && csSettings.n8nBlastUrl
      ? csSettings.n8nBlastUrl
      : null
  if (!blastUrl) {
    return NextResponse.json({ error: 'blast_url_nao_configurada' }, { status: 400 })
  }
  const blastSecret =
    typeof csSettings.n8nBlastSecret === 'string' && csSettings.n8nBlastSecret
      ? csSettings.n8nBlastSecret
      : undefined

  // ── Load Supabase connection string ───────────────────────────────────────────
  const dsRow = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.tenantId, tenantId), eq(dataSources.providerKey, PROVIDER_KEY)))
    .then(r => r[0])

  if (!dsRow?.configEnc) {
    return NextResponse.json({ error: 'fonte_sdr_nao_configurada' }, { status: 400 })
  }

  let connectionString: string
  try {
    const cfg = JSON.parse(decrypt(dsRow.configEnc)) as { connectionString?: string }
    if (!cfg.connectionString) throw new Error('connectionString ausente')
    connectionString = cfg.connectionString
  } catch (err) {
    return NextResponse.json(
      { error: 'config_invalid', message: (err as Error).message },
      { status: 500 },
    )
  }

  // ── Resolve remetente + recipients (SOMENTE SELECT — nunca escreve) ───────────
  const client = new Client({ connectionString })
  let recipients: { leadId: string; phone: string; first_name: string; message: string; session_id: string }[]
  let remetente: string

  try {
    await client.connect()

    const cfgRes = await client.query<{ remetente: string | null }>(
      `SELECT remetente FROM campaign_config ORDER BY updated_at DESC LIMIT 1`,
    )
    const rem = cfgRes.rows[0]?.remetente?.trim()
    if (!rem) {
      return NextResponse.json({ error: 'remetente_nao_configurado' }, { status: 400 })
    }
    remetente = rem

    const leadsRes = await client.query<LeadRow>(
      `SELECT id, name, phone, phone_adjusted FROM leads WHERE id = ANY($1)`,
      [leadIds],
    )

    recipients = []
    for (const r of leadsRes.rows) {
      const phone = ensureBr9(toE164(r.phone, r.phone_adjusted) ?? '')
      if (!phone) continue  // sem telefone válido → skip
      const dbFirst    = String(r.name ?? '').trim().split(/\s+/)[0] ?? ''
      const first_name = dbFirst || names[r.id] || DEFAULT_FIRST_NAME
      const message    = renderMessage(templateBody, first_name)
      const rawSession = (r.phone_adjusted ?? r.phone ?? '').replace(/\D/g, '')
      const session_id = rawSession || phone.replace(/\D/g, '')
      recipients.push({ leadId: r.id, phone, first_name, message, session_id })
    }
  } catch (err) {
    console.error('[sdr blast resolve]', err)
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 502 },
    )
  } finally {
    await client.end().catch(() => {})
  }

  const skipped = leadIds.length - recipients.length
  if (recipients.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'nenhum destinatário com telefone válido', totalSolicitado: leadIds.length, skipped },
      { status: 400 },
    )
  }

  // ── Persist campaign + recipients in Turso (before calling n8n) ──────────────
  const campaignId = randomUUID()
  const now = new Date()

  await db.insert(blastCampaigns).values({
    id: campaignId,
    tenantId,
    template,
    templateBody: templateBody || null,
    totalSolicitado: leadIds.length,
    skipped,
    started: 0,
    status: 'enviando',
    createdBy: session.user.id,
    createdAt: now,
  })

  const recipientRows = recipients.map(r => ({
    id: randomUUID(),
    campaignId,
    leadId: r.leadId,
    phone: r.phone,
    firstName: r.first_name,
    messageBody: r.message,
    status: 'pendente' as const,
    createdAt: now,
  }))
  await db.insert(blastRecipients).values(recipientRows)

  await logAudit({ req: request, session, action: 'disparo.manual', entityType: 'campaign', entityId: campaignId, metadata: { template, totalSolicitado: leadIds.length, skipped } })

  // Build enriched payload for n8n (add campaignId + recipientId per item)
  const enrichedRecipients = recipientRows.map((row, i) => ({
    recipientId: row.id,
    phone: row.phone,
    first_name: recipients[i].first_name,
    message: recipients[i].message,
    session_id: recipients[i].session_id,
  }))

  // ── Trigger blast on n8n (app never sends WhatsApp directly — n8n does) ───────
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (blastSecret) headers['Authorization'] = `Bearer ${blastSecret}`

    const res = await fetch(blastUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenantId, campaignId, template, remetente, recipients: enrichedRecipients }),
      signal: AbortSignal.timeout(15_000),
    })

    let started: number | undefined
    try {
      const data = await res.json() as Record<string, unknown>
      if (typeof data.started === 'number') started = data.started
    } catch { /* n8n resposta sem corpo/JSON */ }

    return NextResponse.json({
      ok:              res.ok,
      campaignId,
      started:         started ?? recipients.length,
      totalSolicitado: leadIds.length,
      skipped,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sdr blast → n8n]', error)
    return NextResponse.json({ ok: false, campaignId, error, totalSolicitado: leadIds.length, skipped }, { status: 502 })
  }
}
