CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_token` text NOT NULL,
	`auth_token` text NOT NULL,
	`salt` blob NOT NULL,
	`encrypted_content` blob NOT NULL,
	`nonce` blob NOT NULL,
	`content_type` text NOT NULL,
	`has_password` integer DEFAULT false NOT NULL,
	`password_salt` blob,
	`password_algo` text,
	`max_views` integer NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notes_expires_at` ON `notes` (`expires_at`);