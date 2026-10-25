CREATE TABLE `library_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_categories_account_name_idx` ON `library_categories` (`account_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `library_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`account_id` text NOT NULL,
	`caption` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`byte_length` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `library_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_photos_object_key_unique` ON `library_photos` (`object_key`);--> statement-breakpoint
CREATE INDEX `library_photos_category_idx` ON `library_photos` (`category_id`);--> statement-breakpoint
CREATE INDEX `library_photos_account_idx` ON `library_photos` (`account_id`);