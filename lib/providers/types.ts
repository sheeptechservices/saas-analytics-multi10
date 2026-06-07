// ─── Platform provider contract ─────────────────────────────────────────────────
//
// Every external data source (the 300's Supabase/n8n, a client's CRM, a warehouse,
// a custom API) is a `DataSourceProvider`. The sync runner is provider-agnostic: it
// loops fetch → normalize → upsert until `done`, persisting the cursor between runs.
//
// Adding a new connection = one file implementing this interface + one line in the
// registry. `fetch` and `normalize` are intentionally separate so `normalize` (the
// messy per-source mapping) can be unit-tested in isolation.

// ─── Canonical shapes (what every provider must produce) ─────────────────────────

/** A numeric time-series point: ad spend/day, KPI, funnel count over time, etc. */
export interface CanonicalMetric {
  metricKey: string
  value: number
  /** ISO date (YYYY-MM-DD) or period bucket (YYYY-MM). */
  date: string
  dimensions?: Record<string, unknown>
  extra?: Record<string, unknown>
}

/** A discrete event / interaction (a lead log, a touchpoint). */
export interface CanonicalEvent {
  /** Stable id at the source — used to build a deterministic row id (idempotent upsert). */
  sourceId: string
  eventType: string
  entityId?: string
  /** Epoch ms. */
  occurredAt: number
  sentiment?: 'positive' | 'neutral' | 'negative' | null
  payload?: Record<string, unknown>
  extra?: Record<string, unknown>
}

/** A single conversation message within a session. */
export interface CanonicalConversation {
  /** Stable id at the source — used to build a deterministic row id. */
  sourceId: string
  sessionId: string
  role: 'human' | 'ai' | 'system'
  content: string
  /** Epoch ms. */
  occurredAt?: number
  metadata?: Record<string, unknown>
}

/** A funnel stage count for a given period. */
export interface CanonicalFunnelStage {
  /** '2026-05' | 'all' */
  period: string
  stageKey: string
  stageName: string
  count: number
  order?: number
  extra?: Record<string, unknown>
}

/** What `normalize` returns for one fetched page. Any subset may be present. */
export interface CanonicalBatch {
  metrics?: CanonicalMetric[]
  events?: CanonicalEvent[]
  conversations?: CanonicalConversation[]
  funnel?: CanonicalFunnelStage[]
}

// ─── Sync plumbing ───────────────────────────────────────────────────────────────

/** Opaque, provider-defined incremental cursor (persisted as JSON on data_sources). */
export type SyncCursor = Record<string, string | number | null>

export interface SyncContext {
  tenantId: string
  dataSourceId: string
  /** null on first run / full backfill. */
  cursor: SyncCursor | null
}

export interface FetchPage<Raw = unknown> {
  raw: Raw
  /** Cursor to persist after this page is committed. */
  nextCursor: SyncCursor | null
  /** true when there are no more pages to fetch this run. */
  done: boolean
}

export interface ConnectionTestResult {
  ok: boolean
  message?: string
}

// ─── The contract ────────────────────────────────────────────────────────────────

export interface DataSourceProvider<Cfg = Record<string, unknown>, Raw = unknown> {
  /** Stable key, also stored on rows as `source` (e.g. 'supabase-n8n'). */
  key: string
  label: string
  /** Validate & shape the decrypted stored config; throw on invalid. */
  parseConfig(raw: unknown): Cfg
  /** Lightweight read-only connectivity check for the config UI. */
  testConnection(cfg: Cfg): Promise<ConnectionTestResult>
  /** Fetch one page of raw data from the source (paginated via the cursor). */
  fetch(cfg: Cfg, ctx: SyncContext): Promise<FetchPage<Raw>>
  /** Pure mapping: raw source data → canonical batch. Unit-testable. */
  normalize(raw: Raw, ctx: SyncContext): CanonicalBatch
}
