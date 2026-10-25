CREATE TABLE `knowledge_reading_progress` (
	`account_id` text PRIMARY KEY NOT NULL,
	`turns` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge_reading_turns` (
	`event_id` text NOT NULL,
	`account_id` text NOT NULL,
	`payload` text NOT NULL,
	`ledger_entry` text,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_reading_turns_event_unique` ON `knowledge_reading_turns` (`account_id`,`event_id`);