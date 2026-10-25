import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  color: text("color").notNull(),
  completed: integer("completed").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("calendar_events_account_date_idx").on(table.accountId, table.date)]);

export const calendarDays = sqliteTable("calendar_days", {
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  type: text("type").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.accountId, table.date] })]);
