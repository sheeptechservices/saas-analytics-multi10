// POST /api/sdr/leads/import
//
// Recebe multipart/form-data com campo "file" (.xlsx/.csv), parseia,
// valida/normaliza/deduplica (ETL na app) e envia os leads NOVOS ao n8nImportUrl.
//
// REGRA CRÍTICA: a app nunca escreve no Supabase.
// O SELECT no Supabase é somente para deduplicação. Inserção = responsabilidade do n8n.
//
// Response: { ok, totalLinhas, importados, ignorados: { total, amostra }, duplicados: { total, amostra }, n8nStatus }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { logAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { dataSources, campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { withSdrDb } from '@/lib/sdr/pg'
import { mapKey, normalizePhone, phoneKey, firstWord } from '@/lib/sdr/leads-etl'
import {
  IMPORT_ERRORS,
  exceedsContentLength,
  exceedsSize,
  extensionError,
  parseImportFile,
} from '@/lib/sdr/import-parse'
import { readN8nSecret } from '@/lib/sdr/settings-merge'

const PROVIDER_KEY   = 'supabase-n8n'
const SOURCE         = 'sdr-n8n'
const AMOSTRA_MAX    = 20

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // Tamanho primeiro: recusa antes de bufferizar o corpo (e antes de ir ao banco).
  if (exceedsContentLength(request.headers.get('content-length'))) {
    return NextResponse.json({ error: IMPORT_ERRORS.tamanho }, { status: 400 })
  }

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

  // Guardado cifrado (legado em texto puro continua legível) — ver lib/sdr/settings-merge.
  const importSecret = readN8nSecret(csSettings, 'n8nImportSecret') ?? undefined

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

  // Tamanho e extensão antes de copiar o arquivo para a memória.
  if (exceedsSize(file.size)) {
    return NextResponse.json({ error: IMPORT_ERRORS.tamanho }, { status: 400 })
  }
  const extErro = extensionError(file.name)
  if (extErro) {
    return NextResponse.json({ error: extErro }, { status: 400 })
  }

  // ── Parse .xlsx/.csv (exceljs — ver lib/sdr/import-parse) ────────────────────
  // Devolve exatamente as mesmas linhas que o SheetJS devolvia; o ETL abaixo
  // não muda. Mensagens de erro já vêm prontas para o usuário.
  const parsed = await parseImportFile({
    fileName: file.name,
    size:     file.size,
    data:     new Uint8Array(await file.arrayBuffer()),
  })
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const rawRows = parsed.rows

  // ── ETL: normalize + classify + dedup within file ────────────────────────────
  type IgnoredEntry  = { linha: number; motivo: string }
  type DupEntry      = { linha: number; telefone: string }
  type SuspeitoEntry = { linha: number; telefone: string }
  type LeadEntry     = { name: string; phone: string; company: string; source: string; status: string }

  const ignorados:  IgnoredEntry[]                               = []
  const duplicados: DupEntry[]                                   = []
  const suspeitos:  SuspeitoEntry[]                             = []
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

  // ── Detect suspicious BR numbers (10-digit national, digit after DDD is 2-5) ──
  // ensureBr9 will NOT fix these — they're ambiguous (landline or mobile without 9th digit).
  for (const c of candidatos) {
    if (!c.phone.startsWith('+55')) continue
    const national = c.phone.slice(3)
    if (national.length === 10 && national[2] >= '2' && national[2] <= '5') {
      suspeitos.push({ linha: c.linha, telefone: c.phone })
    }
  }

  // ── Dedup against Supabase (SOMENTE SELECT — nunca escreve) ──────────────────
  // Uses phoneKey on both columns to match across heterogeneous formats:
  // DB phone may be raw/masked; phone_adjusted is digits-only without '+'.
  const existingByKey = new Map<string, { id: string; name: string | null }>()  // phoneKey → { id, name } (1ª ocorrência vence)

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
      try {
        const cfg = JSON.parse(decrypt(dsRow.configEnc)) as { connectionString?: string }
        if (cfg.connectionString) {
          // Fetch broadly — exact-string match is unreliable across formats;
          // phoneKey normalizes both sides in the app. SELECT only — never writes.
          type DedupRow = { id: string; name: string | null; phone: string | null; phone_adjusted: string | null }
          // Perfil 'largo': esta varredura é a consulta mais pesada da app (a tabela
          // inteira de leads do cliente) e o catch abaixo engole a falha de propósito.
          // Com o teto curto, uma base grande derrubaria a dedup em silêncio e os
          // leads já cadastrados seriam importados — e disparados — de novo.
          const res = await withSdrDb(cfg.connectionString, sdr => sdr.query<DedupRow>(
            `SELECT id, name, phone, phone_adjusted
               FROM leads
              WHERE phone IS NOT NULL OR phone_adjusted IS NOT NULL`,
          ), 'largo')
          for (const r of res.rows) {
            const k1 = phoneKey(r.phone ?? '')
            const k2 = phoneKey(r.phone_adjusted ?? '')
            const entry = { id: r.id, name: r.name }
            if (k1 && !existingByKey.has(k1)) existingByKey.set(k1, entry)
            if (k2 && !existingByKey.has(k2)) existingByKey.set(k2, entry)
          }
        }
      } catch (err) {
        // Non-fatal: skip Supabase dedup if DB is unavailable, proceed with file-only dedup
        console.error('[sdr import dedup]', err)
      }
    }
  }

  // Partition candidatos into novos (new) vs supabase-duplicates
  type UpdateEntry = { id: string; name: string; company: string; source: string; status: string }
  const novos: LeadEntry[] = []
  const updates: UpdateEntry[] = []
  const existingLeadIdSet = new Set<string>()  // ids dos leads JÁ cadastrados que casaram na dedup
  const updatedIdSet = new Set<string>()        // dedup ids within updates
  const names: Record<string, string> = {}      // leadId → 1º nome do Excel (só duplicados com nome não-vazio)
  let semNome = 0                               // destinatários que ficarão sem nome em lugar nenhum
  for (const c of candidatos) {
    if (existingByKey.has(c.key)) {
      duplicados.push({ linha: c.linha, telefone: c.phone })
      const existing = existingByKey.get(c.key)!
      existingLeadIdSet.add(existing.id)
      if (!updatedIdSet.has(existing.id)) {
        updatedIdSet.add(existing.id)
        updates.push({ id: existing.id, name: c.name, company: c.company, source: c.source, status: c.status })
      }
      if (c.name.trim()) {
        names[existing.id] = firstWord(c.name)
      }
      const dbName = (existing.name ?? '').trim()
      if (!dbName && !c.name.trim()) semNome++
    } else {
      novos.push({ name: c.name, phone: c.phone, company: c.company, source: c.source, status: c.status })
      if (!c.name.trim()) semNome++
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
        { ok: false, error: 'Falha ao enviar para importação: ' + (err instanceof Error ? err.message : String(err)) },
        { status: 502 },
      )
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────────
  await logAudit({ req: request, session, action: 'leads.import', metadata: { inserted: novos.length, updated: updates.length, skipped: ignorados.length, total: rawRows.length } })
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
    suspeitos: {
      total:   suspeitos.length,
      amostra: suspeitos.slice(0, AMOSTRA_MAX),
    },
    n8nStatus,
    leadIds,
    existingLeadIds: Array.from(existingLeadIdSet),
    names,
    semNome,
  })
}
