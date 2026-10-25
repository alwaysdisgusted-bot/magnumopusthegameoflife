import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const profileShowcases = sqliteTable("profile_showcases", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  quoteIds: text("quote_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  check("profile_showcases_quotes_check", sql`json_valid(${table.quoteIds}) AND json_type(${table.quoteIds}) = 'array' AND json_array_length(${table.quoteIds}) <= 6`),
]);
