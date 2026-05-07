import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations, pipelines, stages, leads, leadExtras } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

const yield_ = () => new Promise<void>(resolve => setImmediate(resolve))

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration?.accessToken || !integration?.accountDomain) {
    return NextResponse.json({ error: 'Kommo não conectado' }, { status: 400 })
  }

  const selectedPipelineId = integration.selectedPipelineId ?? null
  if (!selectedPipelineId) {
    return NextResponse.json({ error: 'Selecione um funil antes de sincronizar' }, { status: 400 })
  }

  const tenantId = session.user.tenantId
  const reqHeaders = { Authorization: `Bearer ${integration.accessToken}` }
  const base = `https://${integration.accountDomain}.kommo.com/api/v4`
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        await yield_() // flush to HTTP layer before blocking on DB ops
      }

      try {
        // ── 1. Clean existing data ────────────────────────────────────────
        await emit({ stage: 'cleaning', message: 'Limpando dados anteriores...' })

        // Delete in FK-safe order: lead_extras → leads → stages → pipelines
        const tenantPipelines = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.tenantId, tenantId))
        const pipelineIds = tenantPipelines.map(p => p.id)
        await db.delete(leadExtras).where(eq(leadExtras.tenantId, tenantId))
        await db.delete(leads).where(eq(leads.tenantId, tenantId))
        if (pipelineIds.length > 0) {
          await db.delete(stages).where(inArray(stages.pipelineId, pipelineIds))
        }
        await db.delete(pipelines).where(eq(pipelines.tenantId, tenantId))

        // ── 2. Sync pipeline + stages ─────────────────────────────────────
        await emit({ stage: 'pipeline', message: 'Sincronizando funil e etapas...' })

        const pipRes = await fetch(`${base}/leads/pipelines`, { headers: reqHeaders })
        if (!pipRes.ok) {
          await emit({ stage: 'error', error: 'Erro ao buscar pipelines do Kommo' })
          controller.close(); return
        }
        const pipData = await pipRes.json()

        let savedPipelineId: string | null = null
        let stageMap = new Map<string, string>() // kommoStageId → local stage id

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

        if (!savedPipelineId) {
          await emit({ stage: 'error', error: 'Funil selecionado não encontrado no Kommo' })
          controller.close(); return
        }

        // ── 3. Fetch users to resolve responsible names ───────────────────
        const userMap = new Map<string, string>() // kommoUserId → name
        let usersPage = 1
        while (true) {
          const usersRes = await fetch(`${base}/users?limit=250&page=${usersPage}`, { headers: reqHeaders })
          if (usersRes.ok) {
            const usersData = await usersRes.json()
            const pageUsers: any[] = usersData._embedded?.users ?? []
            for (const u of pageUsers) userMap.set(String(u.id), u.name ?? `User ${u.id}`)
            if (pageUsers.length < 250) break
            usersPage++
          } else {
            break // non-fatal: fall back to id-based names
          }
        }

        // ── 4. Fetch loss reasons ─────────────────────────────────────────
        const lossReasonMap = new Map<string, string>() // kommoLossReasonId → name
        const lrRes = await fetch(`${base}/leads/loss_reasons`, { headers: reqHeaders })
        if (lrRes.ok) {
          const lrData = await lrRes.json()
          for (const lr of lrData._embedded?.loss_reasons ?? []) {
            lossReasonMap.set(String(lr.id), lr.name ?? '')
          }
        } // non-fatal: fall back to null if not available

        // ── 5. Sync leads with pagination ─────────────────────────────────
        let synced = 0
        let page = 1
        await emit({ stage: 'leads', synced: 0, message: 'Importando leads...' })

        while (true) {
          const leadsUrl = `${base}/leads?limit=250&page=${page}&filter[pipeline_id]=${selectedPipelineId}`
          const leadsRes = await fetch(leadsUrl, { headers: reqHeaders })
          if (!leadsRes.ok) {
            await emit({ stage: 'error', error: 'Erro ao buscar leads do Kommo' })
            controller.close(); return
          }
          const leadsData = await leadsRes.json()
          const pageLeads: any[] = leadsData._embedded?.leads ?? []
          if (pageLeads.length === 0) break

          // Bulk insert page in a single SQLite transaction
          const now = new Date()
          const rows = pageLeads.flatMap(lead => {
            const stageId = stageMap.get(String(lead.status_id))
            if (!stageId) return []
            return [{
              id: uid(), tenantId, pipelineId: savedPipelineId!,
              stageId, kommoId: String(lead.id),
              name: lead.name ?? '',
              responsibleName: lead.responsible_user_id ? (userMap.get(String(lead.responsible_user_id)) ?? `User ${lead.responsible_user_id}`) : '—',
              lossReason: lead.loss_reason_id ? (lossReasonMap.get(String(lead.loss_reason_id)) ?? null) : null,
              price: lead.price ?? 0,
              createdAt: new Date((lead.created_at ?? 0) * 1000),
              updatedAt: new Date((lead.updated_at ?? 0) * 1000),
              syncedAt: now,
            }]
          })

          // Insert all rows of this page — better-sqlite3 resolves synchronously,
          // so these awaits return instantly (no async overhead, just required by Drizzle API)
          for (const row of rows) {
            await db.insert(leads).values(row)
          }

          synced += rows.length
          await emit({ stage: 'leads', synced, message: `${synced} leads importados...` })

          if (pageLeads.length < 250) break
          page++
        }

        // ── 4. Update lastSyncAt ──────────────────────────────────────────
        await db.update(integrations)
          .set({ lastSyncAt: new Date() })
          .where(eq(integrations.id, integration.id))

        await emit({ stage: 'done', synced, ok: true })
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        console.error('[kommo/sync] ERROR:', msg)
        try { await emit({ stage: 'error', error: `Erro: ${msg}` }) } catch {}
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  })
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration) return NextResponse.json({ status: 'disconnected', lastSyncAt: null })

  const now = new Date()
  let status = 'disconnected'
  if (integration.accessToken) {
    status = integration.expiresAt && integration.expiresAt < now ? 'expired' : 'connected'
  } else if (integration.clientId) {
    status = 'configured'
  }

  return NextResponse.json({
    status,
    accountDomain: integration.accountDomain,
    lastSyncAt: integration.lastSyncAt,
    hasCredentials: !!(integration.clientId && integration.clientSecret),
    selectedPipelineId: integration.selectedPipelineId ?? null,
    selectedPipelineName: integration.selectedPipelineName ?? null,
  })
}
