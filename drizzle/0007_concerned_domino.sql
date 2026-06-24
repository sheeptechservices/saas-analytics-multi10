CREATE TABLE `blast_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`template` text NOT NULL,
	`template_body` text,
	`total_solicitado` integer NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`started` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'enviando' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `blast_campaigns_tenant_created_at_idx` ON `blast_campaigns` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `blast_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`phone` text NOT NULL,
	`first_name` text NOT NULL,
	`message_body` text NOT NULL,
	`ycloud_message_id` text,
	`status` text DEFAULT 'pendente' NOT NULL,
	`error_code` text,
	`error_message` text,
	`last_status_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `blast_campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blast_recipients_campaign_idx` ON `blast_recipients` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `blast_recipients_ycloud_message_idx` ON `blast_recipients` (`ycloud_message_id`);