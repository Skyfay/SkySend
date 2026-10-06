CREATE TABLE `file_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`vault` blob NOT NULL,
	`vault_nonce` blob NOT NULL,
	`inbox_auth_token` text NOT NULL,
	`inbox_owner_token` text NOT NULL,
	`upload_token` text NOT NULL,
	`title_ciphertext` blob,
	`title_nonce` blob,
	`has_password` integer DEFAULT false NOT NULL,
	`max_uploads` integer NOT NULL,
	`max_size` integer NOT NULL,
	`reserved_uploads` integer DEFAULT 0 NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	`finished_uploads` integer DEFAULT 0 NOT NULL,
	`finished_bytes` integer DEFAULT 0 NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`closes_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_file_requests_closes_at` ON `file_requests` (`closes_at`);--> statement-breakpoint
CREATE TABLE `request_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`size` integer NOT NULL,
	`file_count` integer DEFAULT 1 NOT NULL,
	`salt` blob NOT NULL,
	`wrap_enc` blob NOT NULL,
	`wrap_ciphertext` blob NOT NULL,
	`encrypted_meta` blob NOT NULL,
	`meta_nonce` blob NOT NULL,
	`max_downloads` integer NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`storage_path` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `file_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_request_uploads_request_id` ON `request_uploads` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_request_uploads_expires_at` ON `request_uploads` (`expires_at`);