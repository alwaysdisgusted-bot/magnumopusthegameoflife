import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const wizardAccounts = sqliteTable("wizard_accounts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().unique(),
  normalizedName: text("normalized_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const wizardSessions = sqliteTable("wizard_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  csrfValue: text("csrf_value").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("wizard_sessions_account_idx").on(table.accountId), index("wizard_sessions_expiry_idx").on(table.expiresAt)]);

export const wizardSaves = sqliteTable("wizard_saves", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  objectKey: text("object_key").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const authAttempts = sqliteTable("auth_attempts", {
  bucketKey: text("bucket_key").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  attempts: integer("attempts").notNull(),
});
