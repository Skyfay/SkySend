ALTER TABLE `file_requests` RENAME COLUMN `title_ciphertext` TO `brief_ciphertext`;--> statement-breakpoint
ALTER TABLE `file_requests` RENAME COLUMN `title_nonce` TO `brief_nonce`;