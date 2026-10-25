CREATE TABLE `social_friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`pair_low` text NOT NULL,
	`pair_high` text NOT NULL,
	`requester_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`pair_low`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_high`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "social_friendships_pair_check" CHECK("social_friendships"."pair_low" < "social_friendships"."pair_high" AND (("social_friendships"."requester_id" = "social_friendships"."pair_low" AND "social_friendships"."recipient_id" = "social_friendships"."pair_high") OR ("social_friendships"."requester_id" = "social_friendships"."pair_high" AND "social_friendships"."recipient_id" = "social_friendships"."pair_low"))),
	CONSTRAINT "social_friendships_status_check" CHECK(("social_friendships"."status" = 'pending' AND "social_friendships"."accepted_at" IS NULL) OR ("social_friendships"."status" = 'accepted' AND "social_friendships"."accepted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_friendships_pair_idx` ON `social_friendships` (`pair_low`,`pair_high`);--> statement-breakpoint
CREATE INDEX `social_friendships_requester_idx` ON `social_friendships` (`requester_id`);--> statement-breakpoint
CREATE INDEX `social_friendships_recipient_idx` ON `social_friendships` (`recipient_id`);--> statement-breakpoint
CREATE TABLE `social_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`sender_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "social_mail_participants_check" CHECK("social_mail"."sender_id" <> "social_mail"."recipient_id")
);
--> statement-breakpoint
CREATE INDEX `social_mail_sender_date_idx` ON `social_mail` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `social_mail_recipient_date_idx` ON `social_mail` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `social_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "social_profiles_visible_check" CHECK("social_profiles"."visible" IN (0,1))
);
