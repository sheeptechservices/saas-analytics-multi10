CREATE TABLE `ad_ads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`external_adset_id` text NOT NULL,
	`external_campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`type` text,
	`synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ad_adsets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`external_campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`daily_budget` real,
	`synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ad_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`objective` text,
	`daily_budget` real,
	`lifetime_budget` real,
	`currency` text,
	`start_date` text,
	`end_date` text,
	`synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ad_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_ad_id` text NOT NULL,
	`external_adset_id` text NOT NULL,
	`external_campaign_id` text NOT NULL,
	`date` text NOT NULL,
	`impressions` integer DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`spend` real DEFAULT 0,
	`reach` integer DEFAULT 0,
	`conversions` real DEFAULT 0,
	`conversion_value` real DEFAULT 0,
	`ctr` real DEFAULT 0,
	`cpc` real DEFAULT 0,
	`cpm` real DEFAULT 0,
	`roas` real DEFAULT 0,
	`frequency` real DEFAULT 0,
	`synced_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`avatar_color` text DEFAULT '#FFB400' NOT NULL,
	`avatar_bg` text DEFAULT '#121316' NOT NULL,
	`photo_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "tenant_id", "name", "email", "password_hash", "role", "avatar_color", "avatar_bg", "photo_url", "created_at") SELECT "id", "tenant_id", "name", "email", "password_hash", "role", "avatar_color", "avatar_bg", "photo_url", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `integrations` ADD `metadata` text;