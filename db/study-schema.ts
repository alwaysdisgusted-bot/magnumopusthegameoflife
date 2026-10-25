import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const personalStudy = sqliteTable("personal_study", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  objectKey: text("object_key").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
