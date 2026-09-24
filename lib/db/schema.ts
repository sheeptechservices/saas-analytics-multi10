import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  timestamp,
  primaryKey,
  index,
  unique,
} from 'drizzle-orm/pg-core'

/* Dialeto: Postgres (Railway). Antes era SQLite/Turso — o mapa das conversões,
 * para quem for escrever o script de cópia dos dados:
 *
 *   integer(..., { mode: 'timestamp' })  →  timestamp(..., { withTimezone: true, mode: 'date' })
 *       No Turso a coluna guardava epoch em SEGUNDOS (é o que o modo 'timestamp'
 *       do drizzle grava). Em Postgres passa a ser timestamptz. Em TypeScript o
 *       tipo continua `Date` dos dois lados, então nenhuma linha do app muda.
 *
 *   integer(..., { mode: 'boolean' })    →  boolean        (0/1  →  false/true)
 *
 *   real()                               →  doublePrecision()
 *       Conversão exata: REAL do SQLite e float8 do Postgres são o mesmo IEEE-754
 *       de 8 bytes, e o driver `pg` já devolve float8 como number nativo. Ver a
 *       nota "dinheiro" mais abaixo para por que NÃO viramos numeric.
 *
 *   integer() guardando epoch em MILISSEGUNDOS  →  bigint({ mode: 'number' })
 *       Esta é a armadilha silenciosa da migração. O INTEGER do SQLite é de 64
 *       bits; o `integer` do Postgres é int4, que estoura em 2.147.483.647.
 *       Date.now() vale ~1,77e12 — 800x o teto. Toda coluna que guarda
 *       Date.now() virou bigint: ai_settings.created_at/updated_at,
 *       ai_usage_logs.created_at, password_reset_tokens.*, job_locks.locked_until.
 *       Contadores pequenos (order, type, count, tokens, version...) seguem int4.
 *
 *   text() guardando JSON                →  text()  (sem mudança — ver events.payload)
 */

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  primaryColor: text('primary_color').notNull().default('#FFB400'),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').references(() => tenants.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // Conta única: toda conta de cliente nasce 'admin' — quem decide isso é
  // app/api/users/route.ts, que grava TENANT_ROLE e ignora papel vindo do corpo.
  // O default da coluna abaixo é letra morta: nenhum insert do projeto omite o
  // papel (api/users, lib/db/seed*.ts, lib/db/create-master.ts). Em Postgres
  // trocá-lo seria barato — um ALTER TABLE ... ALTER COLUMN ... SET DEFAULT, sem
  // recriar tabela nem índice, ao contrário do que valia no SQLite —, mas segue
  // como está porque mudar não teria efeito nenhum sobre o comportamento.
  // 'manager' e 'user' seguem no enum porque existem linhas antigas no banco;
  // lib/roles.ts trata as duas como admin.
  role: text('role', { enum: ['master', 'admin', 'manager', 'user'] }).notNull().default('user'),
  avatarColor: text('avatar_color').notNull().default('#FFB400'),
  avatarBg: text('avatar_bg').notNull().default('#121316'),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull().default('kommo'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  accountDomain: text('account_domain'),
  accountId: text('account_id'),
  clientId: text('client_id'),
  clientSecret: text('client_secret'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
  selectedPipelineId: text('selected_pipeline_id'),
  selectedPipelineName: text('selected_pipeline_name'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const pipelines = pgTable('pipelines', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  kommoId: text('kommo_id'),
  name: text('name').notNull(),
  isArchived: boolean('is_archived').notNull().default(false),
})

export const stages = pgTable('stages', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id),
  kommoId: text('kommo_id'),
  name: text('name').notNull(),
  color: text('color').notNull().default('#AAAAAA'),
  order: integer('order').notNull().default(0),
  type: integer('type').notNull().default(0),
})

export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id),
  stageId: text('stage_id').notNull().references(() => stages.id),
  kommoId: text('kommo_id'),
  name: text('name').notNull(),
  responsibleName: text('responsible_name').notNull().default('—'),
  // Dinheiro, mas doublePrecision — ver a nota "dinheiro" no fim do arquivo.
  price: doublePrecision('price').notNull().default(0),
  lossReason: text('loss_reason'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
})

export const salesTeams = pgTable('sales_teams', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#FFB400'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const teamMembers = pgTable('team_members', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => salesTeams.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  responsibleName: text('responsible_name').notNull(),
})

export const leadExtras = pgTable('lead_extras', {
  id: text('id').primaryKey(),
  leadId: text('lead_id').notNull().references(() => leads.id).unique(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  tags: text('tags').notNull().default('[]'),
  notes: text('notes').notNull().default(''),
  priority: text('priority', { enum: ['high', 'normal', 'low'] }).notNull().default('normal'),
  customFields: text('custom_fields').notNull().default('{}'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const aiSettings = pgTable('ai_settings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().unique().references(() => tenants.id),
  apiKeyEnc: text('api_key_enc'),
  defaultModel: text('default_model').default('claude-haiku-4-5-20251001'),
  monthlyBudgetBrl: doublePrecision('monthly_budget_brl').default(0),
  cachedSpendUsd: doublePrecision('cached_spend_usd').default(0),
  budgetMonth: text('budget_month'),
  // Flag 0/1 numérica, não booleana: app/api/ai-chat compara `isActive === 0` e
  // app/api/ai-settings grava `apiKey ? 1 : 0`. Continua inteiro de propósito.
  isActive: integer('is_active').default(0),
  // bigint: guarda Date.now() (epoch ms), que não cabe em int4.
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
})

export const aiUsageLogs = pgTable('ai_usage_logs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: doublePrecision('cost_usd').notNull(),
  feature: text('feature').default('chat'),
  // bigint: Date.now() (epoch ms).
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
})

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  // bigint nos três: todos guardam Date.now() (epoch ms).
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  usedAt: bigint('used_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().$defaultFn(() => Date.now()),
})

export const adCampaigns = pgTable('ad_campaigns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  status: text('status'),
  objective: text('objective'),
  dailyBudget: doublePrecision('daily_budget'),
  lifetimeBudget: doublePrecision('lifetime_budget'),
  currency: text('currency'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  syncedAt: text('synced_at'),
  // O `::text` é obrigatório: o Postgres recusa um default timestamptz numa
  // coluna text ("default expression is of type timestamp with time zone").
  // O texto sai com fração de segundo, que o CURRENT_TIMESTAMP do SQLite não
  // tinha; ninguém lê esta coluna, então o formato não afeta nada.
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP::text`),
})

export const adAdsets = pgTable('ad_adsets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  externalCampaignId: text('external_campaign_id').notNull(),
  name: text('name').notNull(),
  status: text('status'),
  dailyBudget: doublePrecision('daily_budget'),
  syncedAt: text('synced_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP::text`),
})

export const adAds = pgTable('ad_ads', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  externalAdsetId: text('external_adset_id').notNull(),
  externalCampaignId: text('external_campaign_id').notNull(),
  name: text('name').notNull(),
  status: text('status'),
  type: text('type'),
  syncedAt: text('synced_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP::text`),
})

export const adInsights = pgTable('ad_insights', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalAdId: text('external_ad_id').notNull(),
  externalAdsetId: text('external_adset_id').notNull(),
  externalCampaignId: text('external_campaign_id').notNull(),
  date: text('date').notNull(),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  spend: doublePrecision('spend').default(0),
  reach: integer('reach').default(0),
  conversions: doublePrecision('conversions').default(0),
  conversionValue: doublePrecision('conversion_value').default(0),
  ctr: doublePrecision('ctr').default(0),
  cpc: doublePrecision('cpc').default(0),
  cpm: doublePrecision('cpm').default(0),
  roas: doublePrecision('roas').default(0),
  frequency: doublePrecision('frequency').default(0),
  syncedAt: text('synced_at'),
})

export const tenantModules = pgTable('tenant_modules', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  moduleKey: text('module_key').notNull(),
  enabled: boolean('enabled').notNull().default(true),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.moduleKey] }),
}))

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const planModules = pgTable('plan_modules', {
  planId: text('plan_id').notNull().references(() => plans.id),
  moduleKey: text('module_key').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.planId, t.moduleKey] }),
}))

// ─── Platform: generic data sources & canonical store ───────────────────────────
// A dedicated, provider-agnostic layer so new clients/connections plug in without
// overloading the Kommo-shaped `integrations` table. Every row is scoped by
// tenantId; provider-specific bits live in JSON `extra`/`config` columns.

export const dataSources = pgTable('data_sources', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  providerKey: text('provider_key').notNull(),            // e.g. 'supabase-n8n'
  label: text('label').notNull().default(''),
  configEnc: text('config_enc'),                          // encrypted JSON (url, read-only key, ...)
  status: text('status', { enum: ['pending', 'connected', 'error'] }).notNull().default('pending'),
  syncCursor: text('sync_cursor'),                        // JSON cursor for incremental sync
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
  lastSyncStatus: text('last_sync_status'),               // 'success' | 'error' | 'running'
  lastSyncError: text('last_sync_error'),
  webhookToken: text('webhook_token'),                      // nullable; set only for webhook-based providers
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => ({
  tenantProviderIdx: index('data_sources_tenant_provider_idx').on(t.tenantId, t.providerKey),
  webhookTokenUnq: unique('data_sources_webhook_token_idx').on(t.webhookToken),
}))

// Generic numeric time-series (ad insights, KPIs, funnel counts over time, ...).
// id is deterministic (tenant:source:metric:date:dims) so sync is idempotent via PK upsert.
export const metrics = pgTable('metrics', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  metricKey: text('metric_key').notNull(),
  value: doublePrecision('value').notNull().default(0),
  date: text('date').notNull(),                           // ISO date or period ('2026-05')
  dimensions: text('dimensions').notNull().default('{}'), // JSON {campaignId, stageId, ...}
  extra: text('extra').notNull().default('{}'),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
}, (t) => ({
  lookupIdx: index('metrics_lookup_idx').on(t.tenantId, t.source, t.metricKey, t.date),
}))

// Discrete events / interactions (lead logs, touches). occurredAt drives incremental cursor.
export const events = pgTable('events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  entityId: text('entity_id'),                            // lead/contact id at the source
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  sentiment: text('sentiment'),                           // positive | neutral | negative | null
  // JSON em text, NÃO jsonb — ver a nota "payload" no fim do arquivo. As duas
  // consultas que espiam dentro dele fazem `payload::jsonb ->> 'chave'`.
  payload: text('payload').notNull().default('{}'),
  extra: text('extra').notNull().default('{}'),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
}, (t) => ({
  lookupIdx: index('events_lookup_idx').on(t.tenantId, t.source, t.occurredAt),
}))

// Conversation messages (chat histories). Grouped by sessionId; alternating roles.
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  sessionId: text('session_id').notNull(),
  role: text('role', { enum: ['human', 'ai', 'system'] }).notNull(),
  content: text('content').notNull().default(''),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }),
  metadata: text('metadata').notNull().default('{}'),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
}, (t) => ({
  sessionIdx: index('conversations_session_idx').on(t.tenantId, t.source, t.sessionId),
}))

// Funnel stage snapshots per period (mirrors the 300's funnel_metrics; also fits Kommo stages).
export const funnelSnapshots = pgTable('funnel_snapshots', {
  id: text('id').primaryKey(),                            // deterministic: tenant:source:period:stageKey
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  period: text('period').notNull(),                       // '2026-05' | 'all'
  stageKey: text('stage_key').notNull(),
  stageName: text('stage_name').notNull(),
  count: integer('count').notNull().default(0),
  order: integer('order').notNull().default(0),
  extra: text('extra').notNull().default('{}'),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
}, (t) => ({
  periodIdx: index('funnel_snapshots_period_idx').on(t.tenantId, t.source, t.period),
}))

// Contact / conversation participant (WhatsApp end-user, CRM contact, etc.).
// id is deterministic (tenant:source:externalId) so webhook upserts are idempotent.
export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),  // stable id at origin (E.164 phone or provider contact id)
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  tags: text('tags').notNull().default('[]'),            // JSON string[]
  lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true, mode: 'date' }),
  metadata: text('metadata').notNull().default('{}'),
  extra: text('extra').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }),
  syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }),
}, (t) => ({
  lookupIdx: index('contacts_lookup_idx').on(t.tenantId, t.source, t.lastInteractionAt),
}))

// Blast campaign header — one row per dispatch action.
export const blastCampaigns = pgTable('blast_campaigns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  template: text('template').notNull(),
  templateBody: text('template_body'),
  totalSolicitado: integer('total_solicitado').notNull(),
  skipped: integer('skipped').notNull().default(0),
  started: integer('started').notNull().default(0),
  status: text('status', { enum: ['enviando', 'concluido', 'erro'] }).notNull().default('enviando'),
  kind: text('kind', { enum: ['manual', 'campanha'] }).notNull().default('manual'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => ({
  tenantCreatedAtIdx: index('blast_campaigns_tenant_created_at_idx').on(t.tenantId, t.createdAt),
}))

// Per-recipient delivery record — one row per lead per campaign.
export const blastRecipients = pgTable('blast_recipients', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => blastCampaigns.id, { onDelete: 'cascade' }),
  leadId: text('lead_id').notNull(),
  phone: text('phone').notNull(),
  firstName: text('first_name').notNull(),
  messageBody: text('message_body').notNull(),
  template: text('template'),
  ycloudMessageId: text('ycloud_message_id'),
  status: text('status', { enum: ['pendente', 'enviado', 'entregue', 'lido', 'falhou'] }).notNull().default('pendente'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  lastStatusAt: timestamp('last_status_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => ({
  campaignIdx: index('blast_recipients_campaign_idx').on(t.campaignId),
  ycloudMessageIdx: index('blast_recipients_ycloud_message_idx').on(t.ycloudMessageId),
}))

// Immutable audit trail — one row per significant action. Never updated or deleted.
export const auditLogs = pgTable('audit_logs', {
  id:          text('id').primaryKey(),
  tenantId:    text('tenant_id'),                                // nullable: master ops may have no tenant
  actorId:     text('actor_id').references(() => users.id),     // nullable: no cascade
  actorEmail:  text('actor_email'),
  actorName:   text('actor_name'),
  actorRole:   text('actor_role'),
  action:      text('action').notNull(),                        // e.g. 'disparo.manual'
  entityType:  text('entity_type'),
  entityId:    text('entity_id'),
  metadata:    text('metadata').notNull().default('{}'),        // JSON
  ip:          text('ip'),
  userAgent:   text('user_agent'),
  createdAt:   timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => ({
  tenantCreatedAtIdx: index('audit_logs_tenant_created_at_idx').on(t.tenantId, t.createdAt),
}))

// Campaign / parameters config per tenant (the "Parâmetros" tab). Passive-persisted,
// modelled with status + version for future write-back to n8n.
export const campaignSettings = pgTable('campaign_settings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  source: text('source').notNull().default('sdr-n8n'),
  settings: text('settings').notNull().default('{}'),     // JSON: tone, cadence, templates, ...
  status: text('status', { enum: ['draft', 'active', 'paused'] }).notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => ({
  tenantSourceUnq: unique('campaign_settings_tenant_source_unq').on(t.tenantId, t.source),
}))

// Global lock for scheduled jobs (lib/cron-lock.ts). The helper creates this table
// itself with CREATE TABLE IF NOT EXISTS, since migrations don't run on deploy;
// this definition and the baseline migration exist for the record.
// locked_until é epoch ms — logo bigint, não integer (Date.now() não cabe em int4).
export const jobLocks = pgTable('job_locks', {
  name: text('name').primaryKey(),
  lockedUntil: bigint('locked_until', { mode: 'number' }).notNull(),
  owner: text('owner'),
})

/* ─── Nota "dinheiro": por que doublePrecision e não numeric ──────────────────
 *
 * Candidatas a numeric: leads.price, ai_settings.monthly_budget_brl e
 * cached_spend_usd, ai_usage_logs.cost_usd, os budgets/métricas de ad_* e
 * metrics.value. Todas ficaram doublePrecision, por três motivos:
 *
 * 1. O driver `pg` devolve numeric como STRING (o int8/numeric não cabe com
 *    segurança num double, então o `pg` não converte por padrão). Isso quebraria
 *    silenciosamente contas que já existem e que somam SEM Number():
 *      app/api/ai-settings/usage/route.ts:53  logs.reduce((s, l) => s + l.costUsd, 0)
 *      app/api/ai-settings/usage/route.ts:64  byModel[log.model].costUsd += log.costUsd
 *      app/api/ai-chat/route.ts:130           cachedSpendUsd: spendBase + costUsd
 *    Com string, `+` concatena: 0 + "0.0004" = "00.0004". Type-check passa, a
 *    conta fica errada, ninguém percebe.
 * 2. A alternativa seria registrar um parser global (pg.types.setTypeParser) —
 *    mas o registro do `pg` é do PROCESSO, e lib/providers/supabase-n8n.ts e as
 *    rotas app/api/sdr/leads/* abrem `new Client()` do mesmo `pg` contra o
 *    Supabase do cliente. Um override global mudaria a leitura daquele banco
 *    também, que não é nosso para mexer.
 * 3. Precisão: no SQLite estes valores JÁ eram IEEE-754 de 8 bytes. float8 do
 *    Postgres é o mesmo formato, bit a bit — a conversão é exata. numeric não
 *    recuperaria precisão que nunca existiu; só daria uma falsa sensação de
 *    exatidão sobre números que são relatório (gasto de anúncio, custo de API em
 *    USD, valor de negócio espelhado do Kommo), não lançamento contábil.
 *
 * DECISÃO, não obviedade: se algum dia entrar cobrança de verdade (fatura,
 * split, conciliação), a coluna certa é numeric(14,2) — e aí os três pontos de
 * soma acima precisam de Number() explícito antes de virar numeric.
 *
 * ─── Nota "payload": por que events.payload segue text e não jsonb ────────────
 *
 * 1. Tipagem: com `text` o tipo em TypeScript continua `string`, então
 *    lib/blast/reconcile.ts:90 (`JSON.parse(ev.payload)`) e lib/sync/runner.ts:85
 *    (`JSON.stringify(...)`) seguem exatamente como estão. Com jsonb o drizzle
 *    devolveria objeto e o JSON.parse quebraria.
 * 2. Coerência: outras 11 colunas deste schema guardam JSON em text (extra,
 *    metadata, dimensions, tags, settings, custom_fields, sync_cursor...).
 *    Converter só uma seria arbitrário.
 * 3. Cópia dos dados: text → text é cópia literal. jsonb validaria cada linha e
 *    abortaria na primeira que não fosse JSON válido — o SQLite nunca exigiu isso.
 * 4. Custo: as duas consultas que olham dentro do payload fazem
 *    `payload::jsonb ->> 'messageId'`. Não existe índice sobre payload hoje, e a
 *    tabela tem ~600 linhas: o cast é irrelevante.
 *
 * Para virar jsonb depois: ALTER TABLE events ALTER COLUMN payload TYPE jsonb
 * USING payload::jsonb, trocar `text` por `jsonb` aqui, e ajustar o parse/
 * stringify nos dois arquivos acima e as duas consultas (que perdem o `::jsonb`).
 */
