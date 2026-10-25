import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const calendarNotes = sqliteTable("calendar_notes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  pins: text("pins").notNull(),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  index("calendar_notes_account_date_idx").on(table.accountId, table.date),
  index("calendar_notes_account_public_idx").on(table.accountId, table.visibility, table.featured, table.updatedAt),
  check("calendar_notes_visibility_check", sql`${table.visibility} IN ('private','public')`),
  check("calendar_notes_featured_check", sql`${table.featured} IN (0,1) AND (${table.visibility} = 'public' OR ${table.featured} = 0)`),
]);

export const calendarBirthdays = sqliteTable("calendar_birthdays", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  year: integer("year"),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("calendar_birthdays_account_date_idx").on(table.accountId, table.month, table.day)]);
