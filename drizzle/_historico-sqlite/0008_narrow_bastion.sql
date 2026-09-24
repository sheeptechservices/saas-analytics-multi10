ALTER TABLE `blast_campaigns` ADD `kind` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `blast_recipients` ADD `template` text;