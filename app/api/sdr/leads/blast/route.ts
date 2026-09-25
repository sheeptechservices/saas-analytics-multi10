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
// As variáveis do template são POSICIONAIS: {{1}} é a primeira, {{2}} a segunda.
// Hoje só existe a primeira (o primeiro nome). Placeholder que sobrar depois do
// render barra o disparo inteiro com 400 — mensagem literal não vai para o lead.
//
// Lead sem nome não recebe template que usa nome: entra em skipped/semNome. Não
// existe saudação de reserva — inventar nome faz a mensagem mentir para o lead.
//
// Body:     { leadIds: string[], template: string, templateBody?: string, names?: Record<string,string> }
// Response: { ok, started, totalSolicitado, skipped, semNome }

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { dataSources, campaignSettings, blastCampaigns, blastRecipients } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { requireTenantUser } from '@/lib/auth-guard'
import { readN8nSecret } from '@/lib/sdr/settings-merge'
import { randomUUID } from 'crypto'
import { getSdrPool, mapSdrDbError } from '@/lib/sdr/pg'
import { CODIGO_CREDENCIAL_SDR_ILEGIVEL } from '@/lib/sdr/mensagens'
// A regra do telefone mora num lugar só: estas funções nasceram aqui, foram copiadas
// para a régua, e agora as duas pontas importam o mesmo módulo. Duas versões de "como
// um telefone brasileiro vira E.164" é como o mesmo lead recebe por um número num
// caminho e por outro no outro.
import { toE164, ensureBr9, renderMessage, unresolvedPlaceholders, POSICIONAL_RE } from '@/lib/sdr/telefone'

const PROVIDER_KEY  = 'supabase-n8n'
const SOURCE        = 'sdr-n8n'
const MAX_LEADS     = 1000
const UUID_RE       = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LeadRow {
  id:             string
  name:           string | null
  phone:          string | null
  phone_adjusted: string | null
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const roleCheck = requireTenantUser(session)
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
  // Guardado cifrado (legado em texto puro continua legível) — ver lib/sdr/settings-merge.
  const blastSecret = readN8nSecret(csSettings, 'n8nBlastSecret') ?? undefined

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
    // Mesma credencial de /api/sdr/leads — a fonte de dados SDR (PROVIDER_KEY acima),
    // não a da YCloud —, logo o mesmo código. Ver lib/sdr/mensagens.
    return NextResponse.json(
      { error: CODIGO_CREDENCIAL_SDR_ILEGIVEL, message: (err as Error).message },
      { status: 500 },
    )
  }

  // ── Resolve remetente + recipients (SOMENTE SELECT — nunca escreve) ───────────
  // O template usa o nome do lead? Então lead sem nome fica de fora — a mensagem
  // não tem como falar com ele sem inventar um nome.
  const templateUsaNome = POSICIONAL_RE.test(templateBody)

  let recipients: { leadId: string; phone: string; first_name: string; message: string; session_id: string }[]
  let encontrados = 0
  let semNome = 0
  let remetente: string

  try {
    // Pool da credencial: TLS obrigatório e tetos de tempo — ver lib/sdr/pg.
    const sdr = getSdrPool(connectionString)

    const cfgRes = await sdr.query<{ remetente: string | null }>(
      `SELECT remetente FROM campaign_config ORDER BY updated_at DESC LIMIT 1`,
    )
    const rem = cfgRes.rows[0]?.remetente?.trim()
    if (!rem) {
      return NextResponse.json({ error: 'remetente_nao_configurado' }, { status: 400 })
    }
    remetente = rem

    const leadsRes = await sdr.query<LeadRow>(
      `SELECT id, name, phone, phone_adjusted FROM leads WHERE id = ANY($1)`,
      [leadIds],
    )

    encontrados = leadsRes.rows.length
    recipients = []
    for (const r of leadsRes.rows) {
      const phone = ensureBr9(toE164(r.phone, r.phone_adjusted) ?? '')
      if (!phone) continue  // sem telefone válido → skip
      const dbFirst    = String(r.name ?? '').trim().split(/\s+/)[0] ?? ''
      const doPedido   = String(names[r.id] ?? '').trim().split(/\s+/)[0] ?? ''
      const first_name = dbFirst || doPedido
      if (!first_name && templateUsaNome) { semNome++; continue }  // sem nome → skip
      const message    = renderMessage(templateBody, [first_name])
      const rawSession = (r.phone_adjusted ?? r.phone ?? '').replace(/\D/g, '')
      const session_id = rawSession || phone.replace(/\D/g, '')
      recipients.push({ leadId: r.id, phone, first_name, message, session_id })
    }
  } catch (err) {
    // Texto do driver fica no log; o cliente recebe só código estável + português.
    console.error('[sdr blast resolve]', err)
    const erro = mapSdrDbError(err)
    return NextResponse.json(
      { error: 'db_error', code: erro.code, message: erro.message },
      { status: 502 },
    )
  }

  const skipped = leadIds.length - recipients.length
  if (recipients.length === 0) {
    const naoEncontrados = leadIds.length - encontrados
    const semTelefone    = encontrados - semNome - recipients.length
    const motivos = [
      semTelefone > 0    ? `${semTelefone} sem telefone válido`   : null,
      semNome > 0        ? `${semNome} sem nome cadastrado`       : null,
      naoEncontrados > 0 ? `${naoEncontrados} fora da base`       : null,
    ].filter(Boolean)
    return NextResponse.json(
      {
        ok: false,
        error: `nenhum destinatário elegível: ${motivos.join(' · ')}`,
        totalSolicitado: leadIds.length,
        skipped,
        semNome,
      },
      { status: 400 },
    )
  }

  // ── Guard: nenhuma mensagem sai com variável por preencher ───────────────────
  // A substituição é posicional; o que o template pedir além disso ({{2}} sem segunda
  // variável, {{nome}}) sobrevive ao render e chegaria literal ao lead. Um disparo
  // não tem volta, então falha aqui — antes de gravar a campanha e chamar o n8n.
  const pendentes = Array.from(new Set(recipients.flatMap(r => unresolvedPlaceholders(r.message))))
  if (pendentes.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `template ${template} tem variável sem valor: ${pendentes.join(' ')} — nada foi enviado`,
        placeholders: pendentes,
        totalSolicitado: leadIds.length,
        skipped,
        semNome,
      },
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

  await logAudit({ req: request, session, action: 'disparo.manual', entityType: 'campaign', entityId: campaignId, metadata: { template, totalSolicitado: leadIds.length, skipped, semNome } })

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
      semNome,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sdr blast → n8n]', error)
    return NextResponse.json({ ok: false, campaignId, error, totalSolicitado: leadIds.length, skipped, semNome }, { status: 502 })
  }
}
