import { createHash } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  dataSources,
  metrics,
  events,
  conversations,
  funnelSnapshots,
} from '@/lib/db/schema'
import { decrypt } from '@/lib/crypto'
import { getProvider } from '@/lib/providers/registry'
import type { CanonicalBatch, SyncContext } from '@/lib/providers/types'

type DataSource = typeof dataSources.$inferSelect

interface UpsertCounts {
  metrics: number
  events: number
  conversations: number
  funnel: number
}

const CHUNK_SIZE = 150

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function hashDims(dims: Record<string, unknown> | undefined): string {
  if (!dims || Object.keys(dims).length === 0) return 'empty'
  return createHash('sha256').update(JSON.stringify(dims)).digest('hex').slice(0, 16)
}

async function upsertBatch(
  batch: CanonicalBatch,
  tenantId: string,
  dataSourceId: string,
  source: string
): Promise<UpsertCounts> {
  const now = new Date()
  const counts: UpsertCounts = { metrics: 0, events: 0, conversations: 0, funnel: 0 }

  if (batch.metrics?.length) {
    const rows = batch.metrics.map(m => ({
      id: `${tenantId}:${source}:${m.metricKey}:${m.date}:${hashDims(m.dimensions)}`,
      tenantId,
      dataSourceId,
      source,
      metricKey: m.metricKey,
      value: m.value,
      date: m.date,
      dimensions: JSON.stringify(m.dimensions ?? {}),
      extra: JSON.stringify(m.extra ?? {}),
      syncedAt: now,
    }))
    for (const chk of chunk(rows, CHUNK_SIZE)) {
      await db.insert(metrics).values(chk).onConflictDoUpdate({
        target: metrics.id,
        set: {
          value:      sql`excluded.value`,
          dimensions: sql`excluded.dimensions`,
          extra:      sql`excluded.extra`,
          syncedAt:   sql`excluded.synced_at`,
        },
      })
    }
    counts.metrics = rows.length
  }

  if (batch.events?.length) {
    const rows = batch.events.map(e => ({
      id: `${tenantId}:${source}:${e.sourceId}`,
      tenantId,
      dataSourceId,
      source,
      eventType:  e.eventType,
      entityId:   e.entityId ?? null,
      occurredAt: new Date(e.occurredAt),
      sentiment:  e.sentiment ?? null,
      payload:    JSON.stringify(e.payload ?? {}),
      extra:      JSON.stringify(e.extra ?? {}),
      syncedAt:   now,
    }))
    for (const chk of chunk(rows, CHUNK_SIZE)) {
      await db.insert(events).values(chk).onConflictDoUpdate({
        target: events.id,
        set: {
          eventType:  sql`excluded.event_type`,
          entityId:   sql`excluded.entity_id`,
          occurredAt: sql`excluded.occurred_at`,
          sentiment:  sql`excluded.sentiment`,
          payload:    sql`excluded.payload`,
          extra:      sql`excluded.extra`,
          syncedAt:   sql`excluded.synced_at`,
        },
      })
    }
    counts.events = rows.length
  }

  if (batch.conversations?.length) {
    const rows = batch.conversations.map(conv => ({
      id: `${tenantId}:${source}:${conv.sourceId}`,
      tenantId,
      dataSourceId,
      source,
      sessionId:  conv.sessionId,
      role:       conv.role,
      content:    conv.content,
      occurredAt: conv.occurredAt != null ? new Date(conv.occurredAt) : null,
      metadata:   JSON.stringify(conv.metadata ?? {}),
      syncedAt:   now,
    }))
    for (const chk of chunk(rows, CHUNK_SIZE)) {
      await db.insert(conversations).values(chk).onConflictDoUpdate({
        target: conversations.id,
        set: {
          role:       sql`excluded.role`,
          content:    sql`excluded.content`,
          occurredAt: sql`excluded.occurred_at`,
          metadata:   sql`excluded.metadata`,
          syncedAt:   sql`excluded.synced_at`,
        },
      })
    }
    counts.conversations = rows.length
  }

  if (batch.funnel?.length) {
    const rows = batch.funnel.map(f => ({
      id: `${tenantId}:${source}:${f.period}:${f.stageKey}`,
      tenantId,
      dataSourceId,
      source,
      period:    f.period,
      stageKey:  f.stageKey,
      stageName: f.stageName,
      count:     f.count,
      order:     f.order ?? 0,
      extra:     JSON.stringify(f.extra ?? {}),
      syncedAt:  now,
    }))
    for (const chk of chunk(rows, CHUNK_SIZE)) {
      await db.insert(funnelSnapshots).values(chk).onConflictDoUpdate({
        target: funnelSnapshots.id,
        set: {
          stageName: sql`excluded.stage_name`,
          count:     sql`excluded.count`,
          order:     sql`excluded."order"`,
          extra:     sql`excluded.extra`,
          syncedAt:  sql`excluded.synced_at`,
        },
      })
    }
    counts.funnel = rows.length
  }

  return counts
}

export async function runSync(dataSource: DataSource): Promise<{
  status: 'success' | 'error'
  counts: UpsertCounts
  error?: string
}> {
  const counts: UpsertCounts = { metrics: 0, events: 0, conversations: 0, funnel: 0 }

  const provider = getProvider(dataSource.providerKey)
  if (!provider) {
    return { status: 'error', counts, error: `Provider desconhecido: ${dataSource.providerKey}` }
  }

  if (!dataSource.configEnc) {
    return { status: 'error', counts, error: 'Fonte não configurada (sem credenciais)' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cfg: any
  try {
    const raw = JSON.parse(decrypt(dataSource.configEnc))
    cfg = provider.parseConfig(raw)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', counts, error: `Erro de config: ${msg}` }
  }

  await db.update(dataSources)
    .set({ lastSyncStatus: 'running' })
    .where(eq(dataSources.id, dataSource.id))

  let currentCtx: SyncContext = {
    tenantId: dataSource.tenantId,
    dataSourceId: dataSource.id,
    cursor: dataSource.syncCursor ? JSON.parse(dataSource.syncCursor) : null,
  }

  try {
    const MAX_PAGES = 200

    for (let page = 0; page < MAX_PAGES; page++) {
      const fetchPage = await provider.fetch(cfg, currentCtx)
      const batch = provider.normalize(fetchPage.raw, currentCtx)

      const pageCounts = await upsertBatch(
        batch,
        dataSource.tenantId,
        dataSource.id,
        dataSource.providerKey
      )
      counts.metrics += pageCounts.metrics
      counts.events += pageCounts.events
      counts.conversations += pageCounts.conversations
      counts.funnel += pageCounts.funnel

      await db.update(dataSources)
        .set({ syncCursor: JSON.stringify(fetchPage.nextCursor) })
        .where(eq(dataSources.id, dataSource.id))

      currentCtx = { ...currentCtx, cursor: fetchPage.nextCursor }
      if (fetchPage.done) break
    }

    await db.update(dataSources)
      .set({ lastSyncAt: new Date(), lastSyncStatus: 'success', lastSyncError: null })
      .where(eq(dataSources.id, dataSource.id))

    return { status: 'success', counts }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(dataSources)
      .set({ lastSyncStatus: 'error', lastSyncError: msg })
      .where(eq(dataSources.id, dataSource.id))
    return { status: 'error', counts, error: msg }
  }
}

export async function runBackfill(dataSource: DataSource): Promise<ReturnType<typeof runSync>> {
  await db.update(dataSources)
    .set({ syncCursor: null })
    .where(eq(dataSources.id, dataSource.id))
  return runSync({ ...dataSource, syncCursor: null })
}
