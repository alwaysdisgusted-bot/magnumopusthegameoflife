CREATE TABLE `knowledge_grimoire_files` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_grimoire_files_object_key_unique` ON `knowledge_grimoire_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `knowledge_grimoire_files_account_idx` ON `knowledge_grimoire_files` (`account_id`);--> statement-breakpoint
CREATE TABLE `knowledge_grimoire_states` (
	`account_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`object_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	`imported_source_hash` text,
	`imported_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
