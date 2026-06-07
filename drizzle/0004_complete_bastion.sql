CREATE TABLE `campaign_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text DEFAULT 'sdr-n8n' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_settings_tenant_source_unq` ON `campaign_settings` (`tenant_id`,`source`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`data_source_id` text,
	`source` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`occurred_at` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversations_session_idx` ON `conversations` (`tenant_id`,`source`,`session_id`);--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_key` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`config_enc` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`sync_cursor` text,
	`last_sync_at` integer,
	`last_sync_status` text,
	`last_sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_sources_tenant_provider_idx` ON `data_sources` (`tenant_id`,`provider_key`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`data_source_id` text,
	`source` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_id` text,
	`occurred_at` integer NOT NULL,
	`sentiment` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_lookup_idx` ON `events` (`tenant_id`,`source`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `funnel_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`data_source_id` text,
	`source` text NOT NULL,
	`period` text NOT NULL,
	`stage_key` text NOT NULL,
	`stage_name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `funnel_snapshots_period_idx` ON `funnel_snapshots` (`tenant_id`,`source`,`period`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`data_source_id` text,
	`source` text NOT NULL,
	`metric_key` text NOT NULL,
	`value` real DEFAULT 0 NOT NULL,
	`date` text NOT NULL,
	`dimensions` text DEFAULT '{}' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`synced_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `metrics_lookup_idx` ON `metrics` (`tenant_id`,`source`,`metric_key`,`date`);