CREATE TABLE `plan_modules` (
	`plan_id` text NOT NULL,
	`module_key` text NOT NULL,
	PRIMARY KEY(`plan_id`, `module_key`),
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
