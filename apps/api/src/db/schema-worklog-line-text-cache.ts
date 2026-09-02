import { index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const worklogLineTextCache = pgTable(
  'worklog_line_text_cache',
  {
    lineMessageId: varchar('line_message_id', { length: 64 }).primaryKey(),
    lineGroupId: varchar('line_group_id', { length: 64 }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }),
    text: text('text').notNull(),
    lineTimestamp: timestamp('line_timestamp', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_line_text_cache_group_message_uq').on(table.lineGroupId, table.lineMessageId),
    index('worklog_line_text_cache_group_time_idx').on(table.lineGroupId, table.lineTimestamp),
    index('worklog_line_text_cache_expires_idx').on(table.expiresAt),
  ],
);
