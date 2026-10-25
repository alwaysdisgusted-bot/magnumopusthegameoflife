CREATE TABLE `quote_settings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`idle_minutes` integer DEFAULT 5 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_quotes` (
	`account_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `quote_id`),
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
