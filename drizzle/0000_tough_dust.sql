CREATE TABLE `auth_attempts` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wizard_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wizard_accounts_owner_id_unique` ON `wizard_accounts` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wizard_accounts_normalized_name_unique` ON `wizard_accounts` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `wizard_saves` (
	`account_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`object_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wizard_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`csrf_value` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wizard_sessions_account_idx` ON `wizard_sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `wizard_sessions_expiry_idx` ON `wizard_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `academy_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `academy_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `academy_channels_room_idx` ON `academy_channels` (`room_id`);--> statement-breakpoint
CREATE TABLE `academy_join_attempts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `academy_members` (
	`room_id` text NOT NULL,
	`account_id` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `account_id`),
	FOREIGN KEY (`room_id`) REFERENCES `academy_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `academy_members_account_idx` ON `academy_members` (`account_id`);--> statement-breakpoint
CREATE TABLE `academy_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `academy_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `academy_messages_channel_time_idx` ON `academy_messages` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `academy_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_account_id` text NOT NULL,
	`invite_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academy_rooms_invite_hash_idx` ON `academy_rooms` (`invite_hash`);--> statement-breakpoint
CREATE TABLE `workspace_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`room_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `academy_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_pages_owner_idx` ON `workspace_pages` (`owner_account_id`);--> statement-breakpoint
CREATE INDEX `workspace_pages_room_idx` ON `workspace_pages` (`room_id`);--> statement-breakpoint
CREATE TABLE `workspace_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_account_id` text NOT NULL,
	`room_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`assignee_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `academy_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspace_tasks_owner_idx` ON `workspace_tasks` (`owner_account_id`);--> statement-breakpoint
CREATE INDEX `workspace_tasks_room_idx` ON `workspace_tasks` (`room_id`);