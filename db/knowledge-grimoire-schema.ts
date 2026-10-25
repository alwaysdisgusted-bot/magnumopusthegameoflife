import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const knowledgeGrimoireStates = sqliteTable("knowledge_grimoire_states", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  objectKey: text("object_key").notNull(),
  updatedAt: integer("updated_at").notNull(),
  importedSourceHash: text("imported_source_hash"),
  importedAt: integer("imported_at"),
});

export const knowledgeGrimoireFiles = sqliteTable("knowledge_grimoire_files", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mediaType: text("media_type").notNull(),
  byteLength: integer("byte_length").notNull(),
  sha256: text("sha256").notNull(),
  objectKey: text("object_key").notNull().unique(),
  createdAt: integer("created_at").notNull(),
}, table => [index("knowledge_grimoire_files_account_idx").on(table.accountId)]);

export const knowledgeTerminology = sqliteTable("knowledge_terminology", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  creationKey: text("creation_key").notNull(),
  revision: integer("revision").notNull(),
  details: text("details").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [uniqueIndex("knowledge_terminology_creation_unique").on(table.accountId, table.creationKey)]);

export const knowledgeTermRewards = sqliteTable("knowledge_term_rewards", {
  termId: text("term_id").primaryKey().references(() => knowledgeTerminology.id),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  ledgerEntry: text("ledger_entry").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const knowledgeReadingProgress = sqliteTable("knowledge_reading_progress", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  turns: integer("turns").notNull(),
});

export const knowledgeReadingTurns = sqliteTable("knowledge_reading_turns", {
  eventId: text("event_id").notNull(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  payload: text("payload").notNull(),
  ledgerEntry: text("ledger_entry"),
}, table => [uniqueIndex("knowledge_reading_turns_event_unique").on(table.accountId, table.eventId)]);
