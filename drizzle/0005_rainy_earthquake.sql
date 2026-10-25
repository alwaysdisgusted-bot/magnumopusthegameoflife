CREATE TABLE `calendar_birthdays` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`year` integer,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_birthdays_account_date_idx` ON `calendar_birthdays` (`account_id`,`month`,`day`);--> statement-breakpoint
CREATE TABLE `calendar_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`pins` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_notes_account_date_idx` ON `calendar_notes` (`account_id`,`date`);