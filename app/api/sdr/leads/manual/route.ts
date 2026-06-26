// POST /api/sdr/leads/manual
//
// Accepts a single lead as JSON, validates/deduplicates, and inserts via n8n
// (same webhook as /api/sdr/leads/import). Never writes to Supabase directly.
//
// Request body: { name: string, phone: string, company?: string }
//
// Responses:
//   200  { ok: true, leadId: string, duplicate: true,  name: string }  — already exists
//   200  { ok: true, leadId: string, duplicate: false, name: string }  — inserted via n8n
//   400  { error: string }                                              — validation / config
//   502  { ok: false, error: string }                                  — n8n unreachable
//   500  { ok: false, error: string }                                  — unexpected

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources, campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { Client } from 'pg'
import { normalizePhone, phoneKey } from '@/lib/sdr/leads-etl'

const PROVIDER_KEY = 'supabase-n8n'
const SOURCE       = 'sdr-n8n'

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const name    = typeof body.name    === 'string' ? body.name.trim()    : ''
  const rawPhone = typeof body.phone  === 'string' ? body.phone.trim()   : ''
  const company = typeof body.company === 'string' ? body.company.trim() : ''

  if (!name) {
    return NextResponse.json({ error: 'nome_obrigatorio' }, { status: 400 })
  }

  const phone = normalizePhone(rawPhone)
  if (!phone) {
    return NextResponse.json({ error: 'telefone_invalido' }, { status: 400 })
  }

  const key = phoneKey(phone)
  if (!key) {
    return NextResponse.json({ error: 'telefone_invalido' }, { status: 400 })
  }

  // ── Load n8nImportUrl + secret ────────────────────────────────────────────
  const [csRow] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  let csSettings: Record<string, unknown> = {}
  if (csRow) {
    try { csSettings = JSON.parse(csRow.settings) } catch {}
  }

  const importUrl =
    typeof csSettings.n8nImportUrl === 'string' && csSettings.n8nImportUrl
      ? csSettings.n8nImportUrl
      : null

  if (!importUrl) {
    return NextResponse.json({ error: 'import_url_nao_configurada' }, { status: 400 })
  }

  const importSecret =
    typeof csSettings.n8nImportSecret === 'string' && csSettings.n8nImportSecret
      ? csSettings.n8nImportSecret
      : undefined

  // ── Dedup against Supabase (SELECT only — never writes) ───────────────────
  let existingId:   string | null = null
  let existingName: string | null = null

  try {
    const dsRow = await db
      .select()
      .from(dataSources)
      .where(and(
        eq(dataSources.tenantId, tenantId),
        eq(dataSources.providerKey, PROVIDER_KEY),
      ))
      .then(r => r[0])

    if (dsRow?.configEnc) {
      const cfg = JSON.parse(decrypt(dsRow.configEnc)) as { connectionString?: string }
      if (cfg.connectionString) {
        const pgClient = new Client({ connectionString: cfg.connectionString })
        try {
          await pgClient.connect()
          const res = await pgClient.query<{
            id: string; name: string | null; phone: string | null; phone_adjusted: string | null
          }>(
            `SELECT id, name, phone, phone_adjusted
               FROM leads
              WHERE phone IS NOT NULL OR phone_adjusted IS NOT NULL`,
          )
          for (const r of res.rows) {
            const k1 = phoneKey(r.phone ?? '')
            const k2 = phoneKey(r.phone_adjusted ?? '')
            if ((k1 && k1 === key) || (k2 && k2 === key)) {
              existingId   = r.id
              existingName = r.name
              break
            }
          }
        } finally {
          await pgClient.end().catch(() => {})
        }
      }
    }
  } catch (err) {
    // Non-fatal: if Supabase is unavailable, skip dedup and proceed to insert.
    // n8n will enforce its own constraints.
    console.error('[sdr manual dedup]', err)
  }

  if (existingId) {
    return NextResponse.json({
      ok: true,
      leadId: existingId,
      duplicate: true,
      name: existingName ?? name,
    })
  }

  // ── POST new lead to n8n ──────────────────────────────────────────────────
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (importSecret) headers['Authorization'] = `Bearer ${importSecret}`

  let leadId: string | null = null
  try {
    const res = await fetch(importUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId,
        leads: [{ name, phone, company: company || null, source: 'manual', status: 'novo' }],
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[sdr manual → n8n] status', res.status, text)
      return NextResponse.json(
        { ok: false, error: `n8n retornou ${res.status}` },
        { status: 502 },
      )
    }

    try {
      const body2 = await res.json() as Record<string, unknown>
      const ids   = Array.isArray(body2.ids) ? body2.ids as unknown[] : []
      const first = ids[0]
      if (typeof first === 'string') leadId = first
    } catch { /* non-JSON body — leadId stays null */ }
  } catch (err) {
    console.error('[sdr manual → n8n]', err)
    return NextResponse.json(
      { ok: false, error: 'Falha ao enviar para importação: ' + (err instanceof Error ? err.message : String(err)) },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, leadId, duplicate: false, name })
}
