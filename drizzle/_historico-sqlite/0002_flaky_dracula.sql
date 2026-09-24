CREATE TABLE `tenant_modules` (
	`tenant_id` text NOT NULL,
	`module_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`tenant_id`, `module_key`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
