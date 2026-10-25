import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { wizardAccounts } from "./auth-schema";

export const socialProfiles = sqliteTable("social_profiles", {
  accountId: text("account_id").primaryKey().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  visible: integer("visible", { mode: "boolean" }).notNull().default(false),
  bio: text("bio").notNull().default(""),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [check("social_profiles_visible_check", sql`${table.visible} IN (0,1)`)]);

export const socialFriendships = sqliteTable("social_friendships", {
  id: text("id").primaryKey(),
  pairLow: text("pair_low").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  pairHigh: text("pair_high").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  requesterId: text("requester_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "accepted"] }).notNull(),
  requestedAt: integer("requested_at").notNull(),
  acceptedAt: integer("accepted_at"),
}, table => [
  uniqueIndex("social_friendships_pair_idx").on(table.pairLow, table.pairHigh),
  index("social_friendships_requester_idx").on(table.requesterId),
  index("social_friendships_recipient_idx").on(table.recipientId),
  check("social_friendships_pair_check", sql`${table.pairLow} < ${table.pairHigh} AND ((${table.requesterId} = ${table.pairLow} AND ${table.recipientId} = ${table.pairHigh}) OR (${table.requesterId} = ${table.pairHigh} AND ${table.recipientId} = ${table.pairLow}))`),
  check("social_friendships_status_check", sql`(${table.status} = 'pending' AND ${table.acceptedAt} IS NULL) OR (${table.status} = 'accepted' AND ${table.acceptedAt} IS NOT NULL)`),
]);

export const socialMail = sqliteTable("social_mail", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id").notNull().references(() => wizardAccounts.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
  readAt: integer("read_at"),
}, table => [
  index("social_mail_sender_date_idx").on(table.senderId, table.createdAt),
  index("social_mail_recipient_date_idx").on(table.recipientId, table.createdAt),
  check("social_mail_participants_check", sql`${table.senderId} <> ${table.recipientId}`),
]);
