CREATE TABLE `knowledge_term_rewards` (
	`term_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`ledger_entry` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `knowledge_terminology`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge_terminology` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`creation_key` text NOT NULL,
	`revision` integer NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_terminology_creation_unique` ON `knowledge_terminology` (`account_id`,`creation_key`);