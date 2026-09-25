// POST /api/sdr/leads/import
//
// Recebe multipart/form-data com campo "file" (.xlsx/.csv), parseia,
// valida/normaliza/deduplica (ETL na app) e grava os leads na base do cliente.
//
// A gravação era um salto HTTP para o n8nImportUrl; hoje a app escreve direto
// (lib/sdr/leads-write), numa instrução só. O que muda para quem lê o relatório: os
// números são os do banco — `importados` é quantos leads o INSERT criou, não quantos
// a app tentou mandar.
//
// Response: { ok, totalLinhas, importados, atualizados, ignorados: { total, amostra }, duplicados: { total, amostra }, ... }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { logAudit } from '@/lib/audit'
import { assertEntitlement } from '@/lib/entitlements'
import { requireTenantUser } from '@/lib/auth-guard'
import { mapSdrDbError, withSdrDb } from '@/lib/sdr/pg'
import { conexaoDoTenant } from '@/lib/sdr/conexao-tenant'
import { CODIGO_CREDENCIAL_SDR_ILEGIVEL } from '@/lib/sdr/mensagens'
import { gravarLeads, limparParaPostgres, type LeadNovo, type LeadUpdate } from '@/lib/sdr/leads-write'
import { mapKey, normalizePhone, phoneKey, firstWord } from '@/lib/sdr/leads-etl'
import {
  IMPORT_ERRORS,
  exceedsContentLength,
  exceedsSize,
  extensionError,
  parseImportFile,
} from '@/lib/sdr/import-parse'

const AMOSTRA_MAX = 20

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  // Tamanho primeiro: recusa antes de bufferizar o corpo (e antes de ir ao banco).
  if (exceedsContentLength(request.headers.get('content-length'))) {
    return NextResponse.json({ error: IMPORT_ERRORS.tamanho }, { status: 400 })
  }

  // ── Conexão do cliente: resolvida UMA vez, usada na dedup e na gravação ───────
  // Pré-requisito da operação inteira, checado antes de parsear o arquivo: sem base
  // não há onde gravar, e dizer "importado" sem ter escrito seria mentir. As duas
  // recusas são separadas de propósito — 400 para quem ainda não cadastrou a fonte,
  // 500 para a credencial que existe e não abre, como já fazem /api/sdr/leads e
  // /api/sdr/leads/blast. Ver lib/sdr/conexao-tenant.
  const fonte = await conexaoDoTenant(tenantId)
  if (fonte.estado === 'nao_configurada') {
    return NextResponse.json({ error: 'fonte_sdr_nao_configurada' }, { status: 400 })
  }
  if (fonte.estado === 'ilegivel') {
    // Código próprio da fonte SDR, não o `config_invalid` genérico: a tela de leads
    // usa o mesmo tradutor para a credencial da YCloud. Ver lib/sdr/mensagens.
    return NextResponse.json({ error: CODIGO_CREDENCIAL_SDR_ILEGIVEL }, { status: 500 })
  }
  const connectionString = fonte.connectionString

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

  const ignorados:  IgnoredEntry[]                               = []
  const duplicados: DupEntry[]                                   = []
  const suspeitos:  SuspeitoEntry[]                             = []
  const candidatos: Array<LeadNovo & { linha: number; key: string }> = []
  const seenKeys   = new Set<string>()

  for (let i = 0; i < rawRows.length; i++) {
    const linha = i + 2  // row 1 = header, data starts at row 2

    // Remap spreadsheet keys to canonical names. `limparParaPostgres` tira o byte NUL
    // e o surrogate solto — sem isso UMA célula ruim derrubava a gravação da planilha
    // inteira (ver lib/sdr/leads-write). A gravação limpa de novo, por garantia; aqui
    // é para o `names` do disparo sair com o mesmo nome que foi gravado na base.
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawRows[i])) {
      row[mapKey(k)] = limparParaPostgres(String(v ?? '')).trim()
    }

    const name    = row.name    || ''
    const phone   = row.phone   || ''
    const company = row.company || ''
    const source  = row.source  || 'import'
    const status  = row.status  || 'novo'

    // E.164 é o formato que sai daqui para a gravação
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
    try {
      // Fetch broadly — exact-string match is unreliable across formats;
      // phoneKey normalizes both sides in the app. SELECT only — never writes.
      type DedupRow = { id: string; name: string | null; phone: string | null; phone_adjusted: string | null }
      // Perfil 'largo': esta varredura é a consulta mais pesada da app (a tabela
      // inteira de leads do cliente) e o catch abaixo engole a falha de propósito.
      // Com o teto curto, uma base grande derrubaria a dedup em silêncio e os
      // leads já cadastrados seriam importados — e disparados — de novo.
      const res = await withSdrDb(connectionString, sdr => sdr.query<DedupRow>(
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
    } catch (err) {
      // Non-fatal: skip Supabase dedup if DB is unavailable, proceed with file-only dedup.
      // A GRAVAÇÃO logo abaixo não tem essa licença: lá a falha vira resposta de erro.
      console.error('[sdr import dedup]', err)
    }
  }

  // Partition candidatos into novos (new) vs supabase-duplicates
  const novos: LeadNovo[] = []
  const updates: LeadUpdate[] = []
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

  // ── Gravação na base do cliente (INSERT + UPDATE numa instrução só) ──────────
  // Diferente da dedup acima, aqui falha NÃO é engolida: sem isto o usuário veria
  // "importado" com o banco intacto.
  let leadIds:    string[] = []
  let atualizados = 0

  try {
    const escrita = await gravarLeads(connectionString, novos, updates)
    leadIds     = escrita.idsInseridos
    atualizados = escrita.atualizados
  } catch (err) {
    // Texto do driver fica no log; o cliente recebe só código estável + português.
    console.error('[sdr import write]', err)
    const erro = mapSdrDbError(err)
    return NextResponse.json(
      { ok: false, error: 'db_error', code: erro.code, message: erro.message },
      { status: 502 },
    )
  }

  // ── Report ────────────────────────────────────────────────────────────────────
  // As contagens são as do banco, não as da intenção: `leadIds.length` é quanto o
  // INSERT criou e `atualizados` é quanto o UPDATE tocou.
  await logAudit({ req: request, session, action: 'leads.import', metadata: { inserted: leadIds.length, updated: atualizados, skipped: ignorados.length, total: rawRows.length } })
  return NextResponse.json({
    ok: true,
    totalLinhas: rawRows.length,
    importados:  leadIds.length,
    atualizados,
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
    leadIds,
    // ATENÇÃO, este não vem do banco: é a lista de quem a DEDUP casou, montada antes
    // da gravação e nunca conferida contra o `atualizados` que o UPDATE devolveu. É
    // intenção, não fato — um id daqui pode ter sumido da base entre a leitura e a
    // escrita. A tela usa isso só para montar o conjunto de destinatários do disparo
    // seguinte, que é o mesmo comportamento de antes.
    existingLeadIds: Array.from(existingLeadIdSet),
    names,
    semNome,
  })
}
