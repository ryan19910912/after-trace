import { bigint, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const worklogPrivateWebEntryNonces = pgTable(
  'worklog_private_web_entry_nonces',
  {
    nonce: varchar('nonce', { length: 128 }).primaryKey(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_private_web_entry_expiry_idx').on(table.expiresAt),
    index('worklog_private_web_entry_user_idx').on(table.userId, table.expiresAt),
    index('worklog_private_web_entry_source_idx').on(table.sourceId, table.expiresAt),
  ],
);
