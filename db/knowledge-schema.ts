import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const knowledgeMaps = sqliteTable("knowledge_maps", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  objectKey: text("object_key").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const knowledgeFiles = sqliteTable("knowledge_files", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  objectKey: text("object_key").notNull().unique(),
  mime: text("mime").notNull(),
  byteLength: integer("byte_length").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("knowledge_files_account_idx").on(table.accountId)]);
