import { db } from '@/lib/db'
import { integrations, pipelines, stages, leads, leadExtras } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export type SyncEmit = (data: object) => Promise<void>

export interface KommoIntegration {
  id: string
  tenantId: string
  accountDomain: string | null
  clientId: string | null
  clientSecret: string | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
  selectedPipelineId: string | null
  lastSyncAt: Date | null
}

export async function refreshKommoToken(integration: KommoIntegration): Promise<string | null> {
  if (!integration.accountDomain || !integration.clientId || !integration.clientSecret || !integration.refreshToken) {
    return null
  }
  const res = await fetch(`https://${integration.accountDomain}.kommo.com/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: integration.clientId,
      client_secret: integration.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: integration.refreshToken,
      redirect_uri: process.env.KOMMO_REDIRECT_URI ?? 'http://localhost:3000/api/kommo/callback',
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)
  await db.update(integrations).set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  }).where(eq(integrations.id, integration.id))
  return data.access_token as string
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function fetchUserMap(base: string, headers: Record<string, string>): Promise<Map<string, string>> {
  const userMap = new Map<string, string>()
  let page = 1
  while (true) {
    const res = await fetch(`${base}/users?limit=250&page=${page}`, { headers })
    if (!res.ok) break
    const data = await res.json()
    const users: any[] = data._embedded?.users ?? []
    for (const u of users) userMap.set(String(u.id), u.name ?? `User ${u.id}`)
    if (users.length < 250) break
    page++
  }
  return userMap
}

async function fetchLossReasonMap(base: string, headers: Record<string, string>): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const res = await fetch(`${base}/leads/loss_reasons`, { headers })
  if (res.ok) {
    const data = await res.json()
    for (const lr of data._embedded?.loss_reasons ?? []) {
      map.set(String(lr.id), lr.name ?? '')
    }
  }
  return map
}

// ─── Full sync (wipe + reimport) ───────────────────────────────────────────────

export async function runKommoSync(
  integration: KommoIntegration,
  emit: SyncEmit = async () => {},
): Promise<{ synced: number }> {
  const { tenantId, accountDomain, accessToken, selectedPipelineId, id: integrationId } = integration

  if (!accessToken || !accountDomain || !selectedPipelineId) {
    throw new Error('Integração incompleta: token, domínio ou funil não configurado')
  }

  const reqHeaders = { Authorization: `Bearer ${accessToken}` }
  const base = `https://${accountDomain}.kommo.com/api/v4`

  // ── 1. Clean existing data ────────────────────────────────────────────────
  await emit({ stage: 'cleaning', message: 'Limpando dados anteriores...' })

  const tenantPipelines = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.tenantId, tenantId))
  const pipelineIds = tenantPipelines.map(p => p.id)
  await db.delete(leadExtras).where(eq(leadExtras.tenantId, tenantId))
  await db.delete(leads).where(eq(leads.tenantId, tenantId))
  if (pipelineIds.length > 0) {
    await db.delete(stages).where(inArray(stages.pipelineId, pipelineIds))
  }
  await db.delete(pipelines).where(eq(pipelines.tenantId, tenantId))

  // ── 2. Sync pipeline + stages ─────────────────────────────────────────────
  await emit({ stage: 'pipeline', message: 'Sincronizando funil e etapas...' })

  const pipRes = await fetch(`${base}/leads/pipelines`, { headers: reqHeaders })
  if (!pipRes.ok) {
    const hint = pipRes.status === 401
      ? ' (token inválido — reconecte a integração)'
      : pipRes.status === 403
        ? ' (sem permissão — verifique os escopos no Kommo)'
        : ` (HTTP ${pipRes.status})`
    throw new Error(`Erro ao buscar pipelines do Kommo${hint}`)
  }
  const pipData = await pipRes.json()

  let savedPipelineId: string | null = null
  const stageMap = new Map<string, string>()

  for (const pip of pipData._embedded?.pipelines ?? []) {
    if (String(pip.id) !== selectedPipelineId) continue

    const pipId = uid()
    await db.insert(pipelines).values({
      id: pipId, tenantId,
      kommoId: String(pip.id), name: pip.name, isArchived: false,
    })
    savedPipelineId = pipId

    for (const stage of pip._embedded?.statuses ?? []) {
      const stageId = uid()
      await db.insert(stages).values({
        id: stageId, pipelineId: pipId,
        kommoId: String(stage.id), name: stage.name,
        color: stage.color ?? '#AAAAAA', order: stage.sort ?? 0, type: stage.type ?? 0,
      })
      stageMap.set(String(stage.id), stageId)
    }
    break
  }

  if (!savedPipelineId) throw new Error('Funil selecionado não encontrado no Kommo')

  // ── 3. Fetch users + loss reasons ─────────────────────────────────────────
  const [userMap, lossReasonMap] = await Promise.all([
    fetchUserMap(base, reqHeaders),
    fetchLossReasonMap(base, reqHeaders),
  ])

  // ── 4. Sync leads with pagination ─────────────────────────────────────────
  let synced = 0
  let page = 1
  await emit({ stage: 'leads', synced: 0, message: 'Importando leads...' })

  while (true) {
    const leadsRes = await fetch(
      `${base}/leads?limit=250&page=${page}&filter[pipeline_id]=${selectedPipelineId}`,
      { headers: reqHeaders },
    )
    if (!leadsRes.ok) throw new Error('Erro ao buscar leads do Kommo')

    const leadsData = await leadsRes.json()
    const pageLeads: any[] = leadsData._embedded?.leads ?? []
    if (pageLeads.length === 0) break

    const now = new Date()
    const rows = pageLeads.flatMap(lead => {
      const stageId = stageMap.get(String(lead.status_id))
      if (!stageId) return []
      return [{
        id: uid(), tenantId, pipelineId: savedPipelineId!,
        stageId, kommoId: String(lead.id),
        name: lead.name ?? '',
        responsibleName: lead.responsible_user_id
          ? (userMap.get(String(lead.responsible_user_id)) ?? `User ${lead.responsible_user_id}`)
          : '—',
        lossReason: lead.loss_reason_id ? (lossReasonMap.get(String(lead.loss_reason_id)) ?? null) : null,
        price: lead.price ?? 0,
        createdAt: new Date((lead.created_at ?? 0) * 1000),
        updatedAt: new Date((lead.updated_at ?? 0) * 1000),
        syncedAt: now,
      }]
    })

    for (const row of rows) {
      await db.insert(leads).values(row)
    }

    synced += rows.length
    await emit({ stage: 'leads', synced, message: `${synced} leads importados...` })

    if (pageLeads.length < 250) break
    page++
  }

  // ── 5. Update lastSyncAt ──────────────────────────────────────────────────
  await db.update(integrations).set({ lastSyncAt: new Date() }).where(eq(integrations.id, integrationId))
  await emit({ stage: 'done', synced, ok: true })

  return { synced }
}

// ─── Incremental sync (upsert leads updated since lastSyncAt) ─────────────────

export async function runKommoIncrementalSync(
  integration: KommoIntegration,
  emit: SyncEmit = async () => {},
): Promise<{ inserted: number; updated: number }> {
  // No lastSyncAt → fall back to full sync
  if (!integration.lastSyncAt) {
    const { synced } = await runKommoSync(integration, emit)
    return { inserted: synced, updated: 0 }
  }

  const { tenantId, accountDomain, accessToken, selectedPipelineId, id: integrationId } = integration

  if (!accessToken || !accountDomain || !selectedPipelineId) {
    throw new Error('Integração incompleta: token, domínio ou funil não configurado')
  }

  const reqHeaders = { Authorization: `Bearer ${accessToken}` }
  const base = `https://${accountDomain}.kommo.com/api/v4`

  // ── 1. Upsert pipeline + stages ───────────────────────────────────────────
  await emit({ stage: 'pipeline', message: 'Atualizando funil e etapas...' })

  const pipRes = await fetch(`${base}/leads/pipelines`, { headers: reqHeaders })
  if (!pipRes.ok) {
    const hint = pipRes.status === 401
      ? ' (token inválido — reconecte a integração)'
      : ` (HTTP ${pipRes.status})`
    throw new Error(`Erro ao buscar pipelines do Kommo${hint}`)
  }
  const pipData = await pipRes.json()

  const existingPipeline = await db.select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.kommoId, selectedPipelineId)))
    .then(r => r[0] ?? null)

  let savedPipelineId: string | null = null
  const stageMap = new Map<string, string>() // kommoStageId → local stage id

  for (const pip of pipData._embedded?.pipelines ?? []) {
    if (String(pip.id) !== selectedPipelineId) continue

    if (existingPipeline) {
      await db.update(pipelines).set({ name: pip.name }).where(eq(pipelines.id, existingPipeline.id))
      savedPipelineId = existingPipeline.id
    } else {
      const pipId = uid()
      await db.insert(pipelines).values({
        id: pipId, tenantId, kommoId: String(pip.id), name: pip.name, isArchived: false,
      })
      savedPipelineId = pipId
    }

    // Upsert stages — keep existing local UUIDs so lead FK refs stay valid
    const existingStages = existingPipeline
      ? await db.select().from(stages).where(eq(stages.pipelineId, existingPipeline.id))
      : []
    const existingStageMap = new Map(existingStages.map(s => [s.kommoId!, s.id]))

    for (const stage of pip._embedded?.statuses ?? []) {
      const kommoStageId = String(stage.id)
      const existingStageId = existingStageMap.get(kommoStageId)
      const stageFields = {
        name: stage.name,
        color: stage.color ?? '#AAAAAA',
        order: stage.sort ?? 0,
        type: stage.type ?? 0,
      }
      if (existingStageId) {
        await db.update(stages).set(stageFields).where(eq(stages.id, existingStageId))
        stageMap.set(kommoStageId, existingStageId)
      } else {
        const stageId = uid()
        await db.insert(stages).values({ id: stageId, pipelineId: savedPipelineId!, kommoId: kommoStageId, ...stageFields })
        stageMap.set(kommoStageId, stageId)
      }
    }
    break
  }

  if (!savedPipelineId) throw new Error('Funil selecionado não encontrado no Kommo')

  // ── 2. Fetch users + loss reasons ─────────────────────────────────────────
  const [userMap, lossReasonMap] = await Promise.all([
    fetchUserMap(base, reqHeaders),
    fetchLossReasonMap(base, reqHeaders),
  ])

  // ── 3. Build existing leads map (kommoId → local id) ─────────────────────
  const existingLeadRows = await db
    .select({ id: leads.id, kommoId: leads.kommoId })
    .from(leads)
    .where(eq(leads.tenantId, tenantId))
  const existingLeadMap = new Map(existingLeadRows.map(l => [l.kommoId!, l.id]))

  // ── 4. Fetch leads updated since lastSyncAt ───────────────────────────────
  const since = Math.floor(integration.lastSyncAt.getTime() / 1000)
  let inserted = 0
  let updated = 0
  let page = 1
  await emit({ stage: 'leads', synced: 0, message: 'Buscando leads atualizados...' })

  while (true) {
    const leadsRes = await fetch(
      `${base}/leads?limit=250&page=${page}&filter[pipeline_id]=${selectedPipelineId}&filter[updated_at][from]=${since}`,
      { headers: reqHeaders },
    )
    if (!leadsRes.ok) throw new Error('Erro ao buscar leads do Kommo')

    const leadsData = await leadsRes.json()
    const pageLeads: any[] = leadsData._embedded?.leads ?? []
    if (pageLeads.length === 0) break

    const now = new Date()
    for (const lead of pageLeads) {
      const kommoLeadId = String(lead.id)
      const stageId = stageMap.get(String(lead.status_id))
      if (!stageId) continue

      const fields = {
        name: lead.name ?? '',
        stageId,
        responsibleName: lead.responsible_user_id
          ? (userMap.get(String(lead.responsible_user_id)) ?? `User ${lead.responsible_user_id}`)
          : '—',
        lossReason: lead.loss_reason_id ? (lossReasonMap.get(String(lead.loss_reason_id)) ?? null) : null,
        price: lead.price ?? 0,
        updatedAt: new Date((lead.updated_at ?? 0) * 1000),
        syncedAt: now,
      }

      const existingId = existingLeadMap.get(kommoLeadId)
      if (existingId) {
        await db.update(leads).set(fields).where(eq(leads.id, existingId))
        updated++
      } else {
        await db.insert(leads).values({
          id: uid(), tenantId, pipelineId: savedPipelineId,
          kommoId: kommoLeadId,
          createdAt: new Date((lead.created_at ?? 0) * 1000),
          ...fields,
        })
        inserted++
      }
    }

    const total = inserted + updated
    await emit({ stage: 'leads', synced: total, message: `${total} leads processados...` })

    if (pageLeads.length < 250) break
    page++
  }

  // ── 5. Update lastSyncAt ──────────────────────────────────────────────────
  await db.update(integrations).set({ lastSyncAt: new Date() }).where(eq(integrations.id, integrationId))
  await emit({ stage: 'done', synced: inserted + updated, ok: true, inserted, updated })

  return { inserted, updated }
}
