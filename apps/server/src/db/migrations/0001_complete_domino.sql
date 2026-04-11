CREATE TABLE `quota_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quota_usage` (
	`hashed_ip` text PRIMARY KEY NOT NULL,
	`bytes_used` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL
);
