CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`actor_id` text,
	`actor_email` text,
	`actor_name` text,
	`actor_role` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_created_at_idx` ON `audit_logs` (`tenant_id`,`created_at`);