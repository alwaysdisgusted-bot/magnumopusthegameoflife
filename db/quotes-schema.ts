import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { wizardAccounts } from './auth-schema';

export const quoteSettings = sqliteTable('quote_settings', {
  accountId: text('account_id').primaryKey().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  enabled: integer('enabled').notNull().default(1),
  idleMinutes: integer('idle_minutes').notNull().default(5),
});
export const savedQuotes = sqliteTable('saved_quotes', {
  accountId: text('account_id').notNull().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  quoteId: text('quote_id').notNull(),
  savedAt: integer('saved_at').notNull(),
}, table => [primaryKey({ columns: [table.accountId, table.quoteId] })]);
