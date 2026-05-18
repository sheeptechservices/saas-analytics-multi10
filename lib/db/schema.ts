import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

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
