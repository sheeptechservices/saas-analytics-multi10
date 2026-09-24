import { createHash } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  dataSources,
  metrics,
  events,
  conversations,
  funnelSnapshots,
  contacts,
} from '@/lib/db/schema'
import { decrypt } from '@/lib/crypto'
import { jsonSemNulos } from '@/lib/json-seguro'
import { getProvider } from '@/lib/providers/registry'
import type { CanonicalBatch, SyncContext } from '@/lib/providers/types'

type DataSource = typeof dataSources.$inferSelect

interface UpsertCounts {
  metrics: number
  events: number
  conversations: number
  funnel: number
  contacts: number
}

const CHUNK_SIZE = 150

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* Uma linha por id, a ÚLTIMA vence.
 *
 * Sem isto, um lote com o mesmo id duas vezes derruba o `ON CONFLICT DO UPDATE`
 * com 21000 ("cannot affect row a second time"): o Postgres proíbe que um único
 * comando toque a mesma linha duas vezes. O SQLite aplicava em silêncio, a
 * última ganhando — que é exatamente o que reproduzimos aqui.
 *
 * E o id vem de dado do provedor, não nosso: `contacts.id` sai do telefone,
 * `funnel_snapshots.id` sai de período+etapa. Basta uma página da YCloud listando
 * o mesmo número duas vezes, ou uma view `funnel_metrics` com duas linhas para o
 * mesmo mês, para o chunk inteiro estourar, `runSync` gravar `last_sync_error` e
 * aquela fonte PARAR de sincronizar. */
function dedupPorId<T extends { id: string }>(
  linhas: T[],
  juntar: (anterior: T, proximo: T) => T = (_anterior, proximo) => proximo,
): T[] {
  const porId = new Map<string, T>()
  for (const linha of linhas) {
    const anterior = porId.get(linha.id)
    porId.set(linha.id, anterior ? juntar(anterior, linha) : linha)
  }
  return [...porId.values()]
}

/* ATENÇÃO: o `juntar` NÃO é enfeite, e o padrão (última vence) só serve para
 * metrics, events, conversations e funnel_snapshots, cujo ON CONFLICT é só
 * `excluded.*` — para essas, "última vence" em JS é idêntico a "última vence"
 * em SQL.
 *
 * `contacts` é diferente: o ON CONFLICT dela ACUMULA (GREATEST na data, COALESCE
 * no nome/telefone/e-mail). Deduplicar com "última vence" jogaria fora o que o
 * SQL preservaria — duas linhas do mesmo número na mesma página da YCloud fariam
 * o nome virar vazio e a "última interação" ANDAR PARA TRÁS, e sem se recuperar,
 * porque o GREATEST da próxima sincronização compara com o valor já rebaixado.
 * Por isso a função abaixo repete, em JS, exatamente as regras do bloco SQL. */

type LinhaDeContato = typeof contacts.$inferInsert

/** Novo valor vence só se vier preenchido — o `COALESCE(NULLIF(x, ''), ...)`. */
function preferirPreenchido(novo: string | null | undefined, antigo: string | null | undefined) {
  return novo != null && novo !== '' ? novo : antigo
}

/** A maior das duas datas, ignorando nulos — o `GREATEST` do Postgres. */
function maiorData(a: Date | null | undefined, b: Date | null | undefined) {
  if (a == null) return b
  if (b == null) return a
  return a >= b ? a : b
}

function juntarContatos(anterior: LinhaDeContato, proximo: LinhaDeContato): LinhaDeContato {
  return {
    ...proximo,
    name:  preferirPreenchido(proximo.name,  anterior.name),
    phone: preferirPreenchido(proximo.phone, anterior.phone),
    email: preferirPreenchido(proximo.email, anterior.email),
    lastInteractionAt: maiorData(proximo.lastInteractionAt, anterior.lastInteractionAt),
    // createdAt: a primeira vence, espelhando o "preserved from the original
    // INSERT" do ON CONFLICT (que simplesmente não lista a coluna).
    createdAt: anterior.createdAt,
  }
}

function hashDims(dims: Record<string, unknown> | undefined): string {
  if (!dims || Object.keys(dims).length === 0) return 'empty'
  return createHash('sha256').update(JSON.stringify(dims)).digest('hex').slice(0, 16)
}

export async function upsertBatch(
  batch: CanonicalBatch,
  tenantId: string,
  dataSourceId: string,
  source: string
): Promise<UpsertCounts> {
  const now = new Date()
  const counts: UpsertCounts = { metrics: 0, events: 0, conversations: 0, funnel: 0, contacts: 0 }

  if (batch.metrics?.length) {
    const rows = batch.metrics.map(m => ({
      id: `${tenantId}:${source}:${m.metricKey}:${m.date}:${hashDims(m.dimensions)}`,
      tenantId,
      dataSourceId,
      source,
      metricKey: m.metricKey,
      value: m.value,
      date: m.date,
      dimensions: jsonSemNulos(m.dimensions ?? {}),
      extra: jsonSemNulos(m.extra ?? {}),
      syncedAt: now,
    }))
    const unicas = dedupPorId(rows)
    for (const chk of chunk(unicas, CHUNK_SIZE)) {
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
    counts.metrics = unicas.length
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
      payload:    jsonSemNulos(e.payload ?? {}),
      extra:      jsonSemNulos(e.extra ?? {}),
      syncedAt:   now,
    }))
    const unicas = dedupPorId(rows)
    for (const chk of chunk(unicas, CHUNK_SIZE)) {
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
    counts.events = unicas.length
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
      metadata:   jsonSemNulos(conv.metadata ?? {}),
      syncedAt:   now,
    }))
    const unicas = dedupPorId(rows)
    for (const chk of chunk(unicas, CHUNK_SIZE)) {
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
    counts.conversations = unicas.length
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
      extra:     jsonSemNulos(f.extra ?? {}),
      syncedAt:  now,
    }))
    const unicas = dedupPorId(rows)
    for (const chk of chunk(unicas, CHUNK_SIZE)) {
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
    counts.funnel = unicas.length
  }

  if (batch.contacts?.length) {
    const rows = batch.contacts.map(c => ({
      id: `${tenantId}:${source}:${c.externalId}`,
      tenantId,
      dataSourceId,
      source,
      externalId:         c.externalId,
      name:               c.name ?? null,
      phone:              c.phone ?? null,
      email:              c.email ?? null,
      tags:               jsonSemNulos(c.tags ?? []),
      lastInteractionAt:  c.lastInteractionAt != null ? new Date(c.lastInteractionAt) : null,
      metadata:           jsonSemNulos(c.metadata ?? {}),
      extra:              jsonSemNulos(c.extra ?? {}),
      createdAt:          now,
      syncedAt:           now,
    }))
    const unicas = dedupPorId(rows, juntarContatos)
    for (const chk of chunk(unicas, CHUNK_SIZE)) {
      await db.insert(contacts).values(chk).onConflictDoUpdate({
        target: contacts.id,
        set: {
          // name/phone/email: preserve existing non-null/non-empty value when new value is absent.
          // NULLIF(x, '') converts '' to NULL so COALESCE falls back to the stored value.
          name:              sql`COALESCE(NULLIF(excluded.name, ''), contacts.name)`,
          phone:             sql`COALESCE(NULLIF(excluded.phone, ''), contacts.phone)`,
          email:             sql`COALESCE(NULLIF(excluded.email, ''), contacts.email)`,
          // tags/metadata/extra: always take the latest payload.
          tags:              sql`excluded.tags`,
          metadata:          sql`excluded.metadata`,
          extra:             sql`excluded.extra`,
          // lastInteractionAt: keep the highest timestamp seen so far.
          // GREATEST, não MAX: o MAX de 2 argumentos é escalar no SQLite, mas no
          // Postgres MAX é agregado de 1 argumento — MAX(a, b) nem existe.
          // O COALESCE(…, 0)/NULLIF(…, 0) que estava aqui sumiu por dois motivos:
          // (1) a coluna agora é timestamptz, e comparar com 0 é erro de tipo;
          // (2) não é mais preciso — o MAX do SQLite devolve NULL se QUALQUER
          // argumento for NULL (daí o COALESCE), enquanto o GREATEST do Postgres
          // IGNORA NULLs e só devolve NULL quando todos são NULL. As três
          // situações dão o mesmo de antes: os dois preenchidos → o maior;
          // um NULL → o outro; os dois NULL → NULL.
          lastInteractionAt: sql`GREATEST(excluded.last_interaction_at, contacts.last_interaction_at)`,
          // createdAt: intentionally omitted — preserved from the original INSERT.
          syncedAt:          sql`excluded.synced_at`,
        },
      })
    }
    counts.contacts = unicas.length
  }

  return counts
}

export async function runSync(dataSource: DataSource): Promise<{
  status: 'success' | 'error'
  counts: UpsertCounts
  error?: string
}> {
  const counts: UpsertCounts = { metrics: 0, events: 0, conversations: 0, funnel: 0, contacts: 0 }

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
      counts.contacts += pageCounts.contacts

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
