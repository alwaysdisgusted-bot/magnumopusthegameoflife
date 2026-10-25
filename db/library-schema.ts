import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const libraryCategories = sqliteTable("library_categories", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(),
}, table => [uniqueIndex("library_categories_account_name_idx").on(table.accountId, table.normalizedName)]);

export const libraryPhotos = sqliteTable("library_photos", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().references(() => libraryCategories.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  caption: text("caption").notNull(),
  objectKey: text("object_key").notNull().unique(),
  mime: text("mime").notNull(),
  byteLength: integer("byte_length").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("library_photos_category_idx").on(table.categoryId), index("library_photos_account_idx").on(table.accountId)]);
