import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { wizardAccounts } from './auth-schema';

export const academyRooms = sqliteTable('academy_rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerAccountId: text('owner_account_id').notNull().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  inviteHash: text('invite_hash').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('academy_rooms_invite_hash_idx').on(table.inviteHash)]);

export const academyMembers = sqliteTable('academy_members', {
  roomId: text('room_id').notNull().references(() => academyRooms.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  joinedAt: text('joined_at').notNull(),
}, table => [primaryKey({ columns: [table.roomId, table.accountId] }), index('academy_members_account_idx').on(table.accountId)]);

export const academyChannels = sqliteTable('academy_channels', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => academyRooms.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('academy_channels_room_idx').on(table.roomId)]);

export const academyMessages = sqliteTable('academy_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => academyChannels.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('academy_messages_channel_time_idx').on(table.channelId, table.createdAt)]);

export const workspacePages = sqliteTable('workspace_pages', {
  id: text('id').primaryKey(),
  ownerAccountId: text('owner_account_id').notNull().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  roomId: text('room_id').references(() => academyRooms.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
}, table => [index('workspace_pages_owner_idx').on(table.ownerAccountId), index('workspace_pages_room_idx').on(table.roomId)]);

export const workspaceTasks = sqliteTable('workspace_tasks', {
  id: text('id').primaryKey(),
  ownerAccountId: text('owner_account_id').notNull().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  roomId: text('room_id').references(() => academyRooms.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['todo', 'doing', 'done'] }).notNull().default('todo'),
  assigneeId: text('assignee_id').references(() => wizardAccounts.id, { onDelete: 'set null' }),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
}, table => [index('workspace_tasks_owner_idx').on(table.ownerAccountId), index('workspace_tasks_room_idx').on(table.roomId)]);

export const academyJoinAttempts = sqliteTable('academy_join_attempts', {
  accountId: text('account_id').primaryKey().references(() => wizardAccounts.id, { onDelete: 'cascade' }),
  windowStart: integer('window_start').notNull(),
  attempts: integer('attempts').notNull().default(0),
});
