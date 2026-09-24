CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`data_source_id` text,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text,
	`phone` text,
	`email` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`last_interaction_at` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`created_at` integer,
	`synced_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_lookup_idx` ON `contacts` (`tenant_id`,`source`,`last_interaction_at`);