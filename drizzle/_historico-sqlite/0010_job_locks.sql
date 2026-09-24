-- IF NOT EXISTS on purpose: lib/cron-lock.ts creates this table at runtime (migrations
-- don't run on deploy), so by the time this migration runs the table may already exist.
CREATE TABLE IF NOT EXISTS `job_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`locked_until` integer NOT NULL,
	`owner` text
);
