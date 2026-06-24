import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, primaryKey, index, unique } from 'drizzle-orm/sqlite-core'

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  primaryColor: text('primary_color').notNull().default('#FFB400'),
  logoUrl: text('logo_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').references(() => tenants.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['master', 'admin', 'manager', 'user'] }).notNull().default('user'),
  avatarColor: text('avatar_color').notNull().default('#FFB400'),
  avatarBg: text('avatar_bg').notNull().default('#121316'),
  photoUrl: text('photo_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull().default('kommo'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  accountDomain: text('account_domain'),
  accountId: text('account_id'),
  clientId: text('client_id'),
  clientSecret: text('client_secret'),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  selectedPipelineId: text('selected_pipeline_id'),
  selectedPipelineName: text('selected_pipeline_name'),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const pipelines = sqliteTable('pipelines', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  kommoId: text('kommo_id'),
  name: text('name').notNull(),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
})

export const stages = sqliteTable('stages', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id),
  kommoId: text('kommo_id'),
  name: text('name').notNull(),
  color: text('color').notNull().default('#AAAAAA'),
  order: integer('order').notNull().default(0),
  type: integer('type').notNull().default(0),
})

export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id),
  stageId: text('stage_id').notNull().references(() => stages.id),
  kommoId: text('kommo_id'),
  name: text('name').notNull(),
  responsibleName: text('responsible_name').notNull().default('—'),
  price: real('price').notNull().default(0),
  lossReason: text('loss_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
})

export const salesTeams = sqliteTable('sales_teams', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#FFB400'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => salesTeams.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  responsibleName: text('responsible_name').notNull(),
})

export const leadExtras = sqliteTable('lead_extras', {
  id: text('id').primaryKey(),
  leadId: text('lead_id').notNull().references(() => leads.id).unique(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  tags: text('tags').notNull().default('[]'),
  notes: text('notes').notNull().default(''),
  priority: text('priority', { enum: ['high', 'normal', 'low'] }).notNull().default('normal'),
  customFields: text('custom_fields').notNull().default('{}'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const aiSettings = sqliteTable('ai_settings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().unique().references(() => tenants.id),
  apiKeyEnc: text('api_key_enc'),
  defaultModel: text('default_model').default('claude-haiku-4-5-20251001'),
  monthlyBudgetBrl: real('monthly_budget_brl').default(0),
  cachedSpendUsd: real('cached_spend_usd').default(0),
  budgetMonth: text('budget_month'),
  isActive: integer('is_active').default(0),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
})

export const aiUsageLogs = sqliteTable('ai_usage_logs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  feature: text('feature').default('chat'),
  createdAt: integer('created_at').notNull(),
})

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
})

export const adCampaigns = sqliteTable('ad_campaigns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  status: text('status'),
  objective: text('objective'),
  dailyBudget: real('daily_budget'),
  lifetimeBudget: real('lifetime_budget'),
  currency: text('currency'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  syncedAt: text('synced_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const adAdsets = sqliteTable('ad_adsets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  externalCampaignId: text('external_campaign_id').notNull(),
  name: text('name').notNull(),
  status: text('status'),
  dailyBudget: real('daily_budget'),
  syncedAt: text('synced_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const adAds = sqliteTable('ad_ads', {
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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const adInsights = sqliteTable('ad_insights', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  externalAdId: text('external_ad_id').notNull(),
  externalAdsetId: text('external_adset_id').notNull(),
  externalCampaignId: text('external_campaign_id').notNull(),
  date: text('date').notNull(),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  spend: real('spend').default(0),
  reach: integer('reach').default(0),
  conversions: real('conversions').default(0),
  conversionValue: real('conversion_value').default(0),
  ctr: real('ctr').default(0),
  cpc: real('cpc').default(0),
  cpm: real('cpm').default(0),
  roas: real('roas').default(0),
  frequency: real('frequency').default(0),
  syncedAt: text('synced_at'),
})

export const tenantModules = sqliteTable('tenant_modules', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  moduleKey: text('module_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.moduleKey] }),
}))

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const planModules = sqliteTable('plan_modules', {
  planId: text('plan_id').notNull().references(() => plans.id),
  moduleKey: text('module_key').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.planId, t.moduleKey] }),
}))

// ─── Platform: generic data sources & canonical store ───────────────────────────
// A dedicated, provider-agnostic layer so new clients/connections plug in without
// overloading the Kommo-shaped `integrations` table. Every row is scoped by
// tenantId; provider-specific bits live in JSON `extra`/`config` columns.

export const dataSources = sqliteTable('data_sources', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  providerKey: text('provider_key').notNull(),            // e.g. 'supabase-n8n'
  label: text('label').notNull().default(''),
  configEnc: text('config_enc'),                          // encrypted JSON (url, read-only key, ...)
  status: text('status', { enum: ['pending', 'connected', 'error'] }).notNull().default('pending'),
  syncCursor: text('sync_cursor'),                        // JSON cursor for incremental sync
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncStatus: text('last_sync_status'),               // 'success' | 'error' | 'running'
  lastSyncError: text('last_sync_error'),
  webhookToken: text('webhook_token'),                      // nullable; set only for webhook-based providers
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  tenantProviderIdx: index('data_sources_tenant_provider_idx').on(t.tenantId, t.providerKey),
  webhookTokenUnq: unique('data_sources_webhook_token_idx').on(t.webhookToken),
}))

// Generic numeric time-series (ad insights, KPIs, funnel counts over time, ...).
// id is deterministic (tenant:source:metric:date:dims) so sync is idempotent via PK upsert.
export const metrics = sqliteTable('metrics', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  metricKey: text('metric_key').notNull(),
  value: real('value').notNull().default(0),
  date: text('date').notNull(),                           // ISO date or period ('2026-05')
  dimensions: text('dimensions').notNull().default('{}'), // JSON {campaignId, stageId, ...}
  extra: text('extra').notNull().default('{}'),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
}, (t) => ({
  lookupIdx: index('metrics_lookup_idx').on(t.tenantId, t.source, t.metricKey, t.date),
}))

// Discrete events / interactions (lead logs, touches). occurredAt drives incremental cursor.
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  entityId: text('entity_id'),                            // lead/contact id at the source
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  sentiment: text('sentiment'),                           // positive | neutral | negative | null
  payload: text('payload').notNull().default('{}'),
  extra: text('extra').notNull().default('{}'),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
}, (t) => ({
  lookupIdx: index('events_lookup_idx').on(t.tenantId, t.source, t.occurredAt),
}))

// Conversation messages (chat histories). Grouped by sessionId; alternating roles.
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  sessionId: text('session_id').notNull(),
  role: text('role', { enum: ['human', 'ai', 'system'] }).notNull(),
  content: text('content').notNull().default(''),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }),
  metadata: text('metadata').notNull().default('{}'),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
}, (t) => ({
  sessionIdx: index('conversations_session_idx').on(t.tenantId, t.source, t.sessionId),
}))

// Funnel stage snapshots per period (mirrors the 300's funnel_metrics; also fits Kommo stages).
export const funnelSnapshots = sqliteTable('funnel_snapshots', {
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
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
}, (t) => ({
  periodIdx: index('funnel_snapshots_period_idx').on(t.tenantId, t.source, t.period),
}))

// Contact / conversation participant (WhatsApp end-user, CRM contact, etc.).
// id is deterministic (tenant:source:externalId) so webhook upserts are idempotent.
export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  dataSourceId: text('data_source_id').references(() => dataSources.id),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),  // stable id at origin (E.164 phone or provider contact id)
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  tags: text('tags').notNull().default('[]'),            // JSON string[]
  lastInteractionAt: integer('last_interaction_at', { mode: 'timestamp' }),
  metadata: text('metadata').notNull().default('{}'),
  extra: text('extra').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
}, (t) => ({
  lookupIdx: index('contacts_lookup_idx').on(t.tenantId, t.source, t.lastInteractionAt),
}))

// Blast campaign header — one row per dispatch action.
export const blastCampaigns = sqliteTable('blast_campaigns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  template: text('template').notNull(),
  templateBody: text('template_body'),
  totalSolicitado: integer('total_solicitado').notNull(),
  skipped: integer('skipped').notNull().default(0),
  started: integer('started').notNull().default(0),
  status: text('status', { enum: ['enviando', 'concluido', 'erro'] }).notNull().default('enviando'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  tenantCreatedAtIdx: index('blast_campaigns_tenant_created_at_idx').on(t.tenantId, t.createdAt),
}))

// Per-recipient delivery record — one row per lead per campaign.
export const blastRecipients = sqliteTable('blast_recipients', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => blastCampaigns.id, { onDelete: 'cascade' }),
  leadId: text('lead_id').notNull(),
  phone: text('phone').notNull(),
  firstName: text('first_name').notNull(),
  messageBody: text('message_body').notNull(),
  ycloudMessageId: text('ycloud_message_id'),
  status: text('status', { enum: ['pendente', 'enviado', 'entregue', 'lido', 'falhou'] }).notNull().default('pendente'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  lastStatusAt: integer('last_status_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  campaignIdx: index('blast_recipients_campaign_idx').on(t.campaignId),
  ycloudMessageIdx: index('blast_recipients_ycloud_message_idx').on(t.ycloudMessageId),
}))

// Campaign / parameters config per tenant (the "Parâmetros" tab). Passive-persisted,
// modelled with status + version for future write-back to n8n.
export const campaignSettings = sqliteTable('campaign_settings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  source: text('source').notNull().default('sdr-n8n'),
  settings: text('settings').notNull().default('{}'),     // JSON: tone, cadence, templates, ...
  status: text('status', { enum: ['draft', 'active', 'paused'] }).notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  tenantSourceUnq: unique('campaign_settings_tenant_source_unq').on(t.tenantId, t.source),
}))
