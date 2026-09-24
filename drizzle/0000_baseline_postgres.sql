CREATE TABLE "ad_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_adset_id" text NOT NULL,
	"external_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"type" text,
	"synced_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP::text
);
--> statement-breakpoint
CREATE TABLE "ad_adsets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"daily_budget" double precision,
	"synced_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP::text
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"objective" text,
	"daily_budget" double precision,
	"lifetime_budget" double precision,
	"currency" text,
	"start_date" text,
	"end_date" text,
	"synced_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP::text
);
--> statement-breakpoint
CREATE TABLE "ad_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_ad_id" text NOT NULL,
	"external_adset_id" text NOT NULL,
	"external_campaign_id" text NOT NULL,
	"date" text NOT NULL,
	"impressions" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"spend" double precision DEFAULT 0,
	"reach" integer DEFAULT 0,
	"conversions" double precision DEFAULT 0,
	"conversion_value" double precision DEFAULT 0,
	"ctr" double precision DEFAULT 0,
	"cpc" double precision DEFAULT 0,
	"cpm" double precision DEFAULT 0,
	"roas" double precision DEFAULT 0,
	"frequency" double precision DEFAULT 0,
	"synced_at" text
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"api_key_enc" text,
	"default_model" text DEFAULT 'claude-haiku-4-5-20251001',
	"monthly_budget_brl" double precision DEFAULT 0,
	"cached_spend_usd" double precision DEFAULT 0,
	"budget_month" text,
	"is_active" integer DEFAULT 0,
	"created_at" bigint,
	"updated_at" bigint,
	CONSTRAINT "ai_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"feature" text DEFAULT 'chat',
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"actor_id" text,
	"actor_email" text,
	"actor_name" text,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blast_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"template" text NOT NULL,
	"template_body" text,
	"total_solicitado" integer NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"started" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'enviando' NOT NULL,
	"kind" text DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blast_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"phone" text NOT NULL,
	"first_name" text NOT NULL,
	"message_body" text NOT NULL,
	"template" text,
	"ycloud_message_id" text,
	"status" text DEFAULT 'pendente' NOT NULL,
	"error_code" text,
	"error_message" text,
	"last_status_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source" text DEFAULT 'sdr-n8n' NOT NULL,
	"settings" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "campaign_settings_tenant_source_unq" UNIQUE("tenant_id","source")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"data_source_id" text,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"tags" text DEFAULT '[]' NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"metadata" text DEFAULT '{}' NOT NULL,
	"extra" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"data_source_id" text,
	"source" text NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone,
	"metadata" text DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"config_enc" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sync_cursor" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"webhook_token" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "data_sources_webhook_token_idx" UNIQUE("webhook_token")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"data_source_id" text,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"sentiment" text,
	"payload" text DEFAULT '{}' NOT NULL,
	"extra" text DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "funnel_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"data_source_id" text,
	"source" text NOT NULL,
	"period" text NOT NULL,
	"stage_key" text NOT NULL,
	"stage_name" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"extra" text DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text DEFAULT 'kommo' NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"account_domain" text,
	"account_id" text,
	"client_id" text,
	"client_secret" text,
	"last_sync_at" timestamp with time zone,
	"selected_pipeline_id" text,
	"selected_pipeline_name" text,
	"metadata" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"locked_until" bigint NOT NULL,
	"owner" text
);
--> statement-breakpoint
CREATE TABLE "lead_extras" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"custom_fields" text DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lead_extras_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"kommo_id" text,
	"name" text NOT NULL,
	"responsible_name" text DEFAULT '—' NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"loss_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"data_source_id" text,
	"source" text NOT NULL,
	"metric_key" text NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"date" text NOT NULL,
	"dimensions" text DEFAULT '{}' NOT NULL,
	"extra" text DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kommo_id" text,
	"name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_modules" (
	"plan_id" text NOT NULL,
	"module_key" text NOT NULL,
	CONSTRAINT "plan_modules_plan_id_module_key_pk" PRIMARY KEY("plan_id","module_key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#FFB400' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"kommo_id" text,
	"name" text NOT NULL,
	"color" text DEFAULT '#AAAAAA' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"type" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"responsible_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_modules" (
	"tenant_id" text NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tenant_modules_tenant_id_module_key_pk" PRIMARY KEY("tenant_id","module_key")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"primary_color" text DEFAULT '#FFB400' NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"avatar_color" text DEFAULT '#FFB400' NOT NULL,
	"avatar_bg" text DEFAULT '#121316' NOT NULL,
	"photo_url" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ad_ads" ADD CONSTRAINT "ad_ads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_adsets" ADD CONSTRAINT "ad_adsets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights" ADD CONSTRAINT "ad_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blast_campaigns" ADD CONSTRAINT "blast_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blast_campaigns" ADD CONSTRAINT "blast_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blast_recipients" ADD CONSTRAINT "blast_recipients_campaign_id_blast_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."blast_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_snapshots" ADD CONSTRAINT "funnel_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_snapshots" ADD CONSTRAINT "funnel_snapshots_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_extras" ADD CONSTRAINT "lead_extras_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_extras" ADD CONSTRAINT "lead_extras_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_teams" ADD CONSTRAINT "sales_teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_sales_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."sales_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_at_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "blast_campaigns_tenant_created_at_idx" ON "blast_campaigns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "blast_recipients_campaign_idx" ON "blast_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "blast_recipients_ycloud_message_idx" ON "blast_recipients" USING btree ("ycloud_message_id");--> statement-breakpoint
CREATE INDEX "contacts_lookup_idx" ON "contacts" USING btree ("tenant_id","source","last_interaction_at");--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("tenant_id","source","session_id");--> statement-breakpoint
CREATE INDEX "data_sources_tenant_provider_idx" ON "data_sources" USING btree ("tenant_id","provider_key");--> statement-breakpoint
CREATE INDEX "events_lookup_idx" ON "events" USING btree ("tenant_id","source","occurred_at");--> statement-breakpoint
CREATE INDEX "funnel_snapshots_period_idx" ON "funnel_snapshots" USING btree ("tenant_id","source","period");--> statement-breakpoint
CREATE INDEX "metrics_lookup_idx" ON "metrics" USING btree ("tenant_id","source","metric_key","date");