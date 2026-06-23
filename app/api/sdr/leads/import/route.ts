// POST /api/sdr/leads/import
//
// Recebe multipart/form-data com campo "file" (.xlsx/.xls), parseia,
// valida/normaliza/deduplica (ETL na app) e envia os leads NOVOS ao n8nImportUrl.
//
// REGRA CRÍTICA: a app nunca escreve no Supabase.
// O SELECT no Supabase é somente para deduplicação. Inserção = responsabilidade do n8n.
//
// Response: { ok, totalLinhas, importados, ignorados: { total, amostra }, duplicados: { total, amostra }, n8nStatus }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources, campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { Client } from 'pg'
import * as XLSX from 'xlsx'

const PROVIDER_KEY   = 'supabase-n8n'
const SOURCE         = 'sdr-n8n'
const MAX_FILE_BYTES = 5 * 1024 * 1024  // 5 MB
const MAX_ROWS       = 1000
const AMOSTRA_MAX    = 20
const E164_RE        = /^\+[1-9]\d{6,14}$/

// Maps spreadsheet header (PT or EN) to internal canonical key.
function mapKey(raw: string): string {
  switch (raw.toLowerCase().trim()) {
    case 'nome':     case 'name':                        return 'name'
    case 'telefone': case 'phone': case 'tel':
    case 'celular':                                      return 'phone'
    case 'empresa':  case 'company':                     return 'company'
    case 'origem':   case 'source':                      return 'source'
    case 'status':                                       return 'status'
    default:                                             return raw.toLowerCase().trim()
  }
}

// Normalizes a phone string to E.164. Returns null if the result is not valid E.164.
// Strategy: keep only digits and leading +; if no +, assume Brazil (+55) when < 12 digits.
function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const stripped = raw.replace(/[^\d+]/g, '')
  if (!stripped) return null

  let normalized: string
  if (stripped.startsWith('+')) {
    normalized = stripped
  } else {
    // No + prefix: use digit count to guess whether country code is present.
    // Brazilian numbers without DDI are 10–11 digits (DDD + number).
    // With +55 they become 12–13 digits.
    normalized = stripped.length >= 12 ? '+' + stripped : '+55' + stripped
  }

  return E164_RE.test(normalized) ? normalized : null
}

// Canonical dedup key — format-agnostic, comparable across the file and the DB.
// Produces DDD(2) + 8 digits, collapsing the 9th-digit mobile prefix so that
// "+5511 9 8888-7777" and the DB value "551188887777" both yield "1188887777".
// Returns null when the input cannot be reduced to a valid key.
function phoneKey(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  let national = digits

  // Strip Brazil DDI when present and remainder is 10 or 11 digits (12/13 total)
  if (national.startsWith('55') && (national.length === 12 || national.length === 13)) {
    national = national.slice(2)
  }

  // Remove 9th-digit mobile prefix: DDD(2) + '9' + 8 digits → DDD(2) + 8 digits
  if (national.length === 11 && national[2] === '9') {
    national = national.slice(0, 2) + national.slice(3)
  }

  return national.length >= 10 ? national : null
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // ── Load n8nImportUrl + secret early — prerequisite for the whole operation ───
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

  // ── Parse multipart/form-data ─────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Esperado multipart/form-data' }, { status: 400 })
  }

  const fileField = formData.get('file')
  if (!fileField || typeof fileField === 'string') {
    return NextResponse.json({ error: 'Campo "file" ausente ou inválido' }, { status: 400 })
  }
  const file = fileField as File

  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    return NextResponse.json({ error: 'Arquivo deve ser .xlsx ou .xls' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Arquivo muito grande (máximo 5 MB)' }, { status: 400 })
  }

  // ── Parse xlsx ────────────────────────────────────────────────────────────────
  let rawRows: Record<string, unknown>[]
  try {
    const arrayBuffer = await file.arrayBuffer()
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' })
    const wsName = wb.SheetNames[0]
    if (!wsName) {
      return NextResponse.json({ error: 'Arquivo sem abas' }, { status: 400 })
    }
    rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wsName], { defval: '' })
  } catch {
    return NextResponse.json({ error: 'Falha ao ler o arquivo xlsx' }, { status: 400 })
  }

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'Arquivo sem linhas de dados' }, { status: 400 })
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_ROWS} linhas por importação (arquivo tem ${rawRows.length})` },
      { status: 400 },
    )
  }

  // ── ETL: normalize + classify + dedup within file ────────────────────────────
  type IgnoredEntry = { linha: number; motivo: string }
  type DupEntry     = { linha: number; telefone: string }
  type LeadEntry    = { name: string; phone: string; company: string; source: string; status: string }

  const ignorados:  IgnoredEntry[]                               = []
  const duplicados: DupEntry[]                                   = []
  const candidatos: Array<LeadEntry & { linha: number; key: string }> = []
  const seenKeys   = new Set<string>()

  for (let i = 0; i < rawRows.length; i++) {
    const linha = i + 2  // row 1 = header, data starts at row 2

    // Remap spreadsheet keys to canonical names
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawRows[i])) {
      row[mapKey(k)] = String(v ?? '').trim()
    }

    const name    = row.name    || ''
    const phone   = row.phone   || ''
    const company = row.company || ''
    const source  = row.source  || 'import'
    const status  = row.status  || 'novo'

    if (!name) {
      ignorados.push({ linha, motivo: 'nome ausente' })
      continue
    }

    // E.164 required for the n8n payload
    const normalized = normalizePhone(phone)
    if (!normalized) {
      ignorados.push({ linha, motivo: 'telefone inválido' })
      continue
    }

    // Canonical key for dedup (format-agnostic, matches DB phone_adjusted format)
    const key = phoneKey(normalized)
    if (!key) {
      ignorados.push({ linha, motivo: 'telefone inválido' })
      continue
    }

    // Dedup within the file (first occurrence wins)
    if (seenKeys.has(key)) {
      duplicados.push({ linha, telefone: normalized })
      continue
    }
    seenKeys.add(key)

    candidatos.push({ linha, name, phone: normalized, company, source, status, key })
  }

  // ── Dedup against Supabase (SOMENTE SELECT — nunca escreve) ──────────────────
  // Uses phoneKey on both columns to match across heterogeneous formats:
  // DB phone may be raw/masked; phone_adjusted is digits-only without '+'.
  const existingKeys    = new Set<string>()
  const existingIdByKey = new Map<string, string>()  // phoneKey → id do lead já cadastrado (1ª ocorrência vence)

  if (candidatos.length > 0) {
    const dsRow = await db
      .select()
      .from(dataSources)
      .where(and(
        eq(dataSources.tenantId, tenantId),
        eq(dataSources.providerKey, PROVIDER_KEY),
      ))
      .then(r => r[0])

    if (dsRow?.configEnc) {
      let pgClient: Client | null = null
      try {
        const cfg = JSON.parse(decrypt(dsRow.configEnc)) as { connectionString?: string }
        if (cfg.connectionString) {
          pgClient = new Client({ connectionString: cfg.connectionString })
          await pgClient.connect()

          // Fetch broadly — exact-string match is unreliable across formats;
          // phoneKey normalizes both sides in the app. SELECT only — never writes.
          const res = await pgClient.query<{ id: string; phone: string | null; phone_adjusted: string | null }>(
            `SELECT id, phone, phone_adjusted
               FROM leads
              WHERE phone IS NOT NULL OR phone_adjusted IS NOT NULL`,
          )
          for (const r of res.rows) {
            const k1 = phoneKey(r.phone ?? '')
            const k2 = phoneKey(r.phone_adjusted ?? '')
            if (k1) { existingKeys.add(k1); if (!existingIdByKey.has(k1)) existingIdByKey.set(k1, r.id) }
            if (k2) { existingKeys.add(k2); if (!existingIdByKey.has(k2)) existingIdByKey.set(k2, r.id) }
          }
        }
      } catch (err) {
        // Non-fatal: skip Supabase dedup if DB is unavailable, proceed with file-only dedup
        console.error('[sdr import dedup]', err)
      } finally {
        if (pgClient) await pgClient.end().catch(() => {})
      }
    }
  }

  // Partition candidatos into novos (new) vs supabase-duplicates
  type UpdateEntry = { id: string; name: string; company: string; source: string; status: string }
  const novos: LeadEntry[] = []
  const updates: UpdateEntry[] = []
  const existingLeadIdSet = new Set<string>()  // ids dos leads JÁ cadastrados que casaram na dedup
  const updatedIdSet = new Set<string>()        // dedup ids within updates
  for (const c of candidatos) {
    if (existingKeys.has(c.key)) {
      duplicados.push({ linha: c.linha, telefone: c.phone })
      const existingId = existingIdByKey.get(c.key)
      if (existingId) {
        existingLeadIdSet.add(existingId)
        if (!updatedIdSet.has(existingId)) {
          updatedIdSet.add(existingId)
          updates.push({ id: existingId, name: c.name, company: c.company, source: c.source, status: c.status })
        }
      }
    } else {
      novos.push({ name: c.name, phone: c.phone, company: c.company, source: c.source, status: c.status })
    }
  }

  // ── POST new leads to n8n (app never writes to Supabase — n8n does) ──────────
  let n8nStatus = 0
  let leadIds:   string[] = []

  if (novos.length > 0 || updates.length > 0) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (importSecret) headers['Authorization'] = `Bearer ${importSecret}`
    try {
      const res = await fetch(importUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tenantId, leads: novos, updates }),
        signal: AbortSignal.timeout(15_000),
      })
      n8nStatus = res.status

      // Tolerantly read n8n response body to extract inserted IDs.
      // n8n may respond { inserted, ids } or a non-JSON body — never throw.
      try {
        const body = await res.json() as Record<string, unknown>
        const raw  = Array.isArray(body.ids) ? body.ids : []
        leadIds    = (raw as unknown[]).filter((v): v is string => typeof v === 'string')
      } catch { /* non-JSON body — leadIds stays [] */ }
    } catch (err) {
      console.error('[sdr import → n8n]', err)
      return NextResponse.json(
        { ok: false, error: 'Falha ao enviar ao n8n: ' + (err instanceof Error ? err.message : String(err)) },
        { status: 502 },
      )
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    totalLinhas: rawRows.length,
    importados:  novos.length,
    atualizados: updates.length,
    ignorados: {
      total:   ignorados.length,
      amostra: ignorados.slice(0, AMOSTRA_MAX),
    },
    duplicados: {
      total:   duplicados.length,
      amostra: duplicados.slice(0, AMOSTRA_MAX),
    },
    n8nStatus,
    leadIds,
    existingLeadIds: Array.from(existingLeadIdSet),
  })
}
