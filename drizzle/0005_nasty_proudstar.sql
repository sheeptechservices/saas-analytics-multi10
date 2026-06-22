ALTER TABLE `data_sources` ADD `webhook_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `data_sources_webhook_token_idx` ON `data_sources` (`webhook_token`);