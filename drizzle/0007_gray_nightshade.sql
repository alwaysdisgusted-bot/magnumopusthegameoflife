CREATE TABLE `profile_showcases` (
 `account_id` text PRIMARY KEY NOT NULL,
 `quote_ids` text DEFAULT '[]' NOT NULL,
 `revision` integer NOT NULL,
 `updated_at` integer NOT NULL,
 FOREIGN KEY (`account_id`) REFERENCES `wizard_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
 CONSTRAINT "profile_showcases_quotes_check" CHECK(json_valid("profile_showcases"."quote_ids") AND json_type("profile_showcases"."quote_ids") = 'array' AND json_array_length("profile_showcases"."quote_ids") <= 6)
);
--> statement-breakpoint
-- Existing notes remain private. Add columns in place to preserve all text and pins.
ALTER TABLE `calendar_notes` ADD `visibility` text DEFAULT 'private' NOT NULL CONSTRAINT `calendar_notes_visibility_check` CHECK (`visibility` IN ('private','public'));
--> statement-breakpoint
ALTER TABLE `calendar_notes` ADD `featured` integer DEFAULT 0 NOT NULL CONSTRAINT `calendar_notes_featured_check` CHECK (`featured` IN (0,1) AND (`visibility` = 'public' OR `featured` = 0));
--> statement-breakpoint
CREATE INDEX `calendar_notes_account_public_idx` ON `calendar_notes` (`account_id`,`visibility`,`featured`,`updated_at`);