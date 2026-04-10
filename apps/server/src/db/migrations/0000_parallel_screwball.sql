CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_token` text NOT NULL,
	`auth_token` text NOT NULL,
	`salt` blob NOT NULL,
	`encrypted_meta` blob,
	`nonce` blob,
	`size` integer NOT NULL,
	`file_count` integer DEFAULT 1 NOT NULL,
	`has_password` integer DEFAULT false NOT NULL,
	`password_salt` blob,
	`password_algo` text,
	`max_downloads` integer NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`storage_path` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_uploads_expires_at` ON `uploads` (`expires_at`);