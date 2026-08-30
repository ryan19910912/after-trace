import { index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const webAuthEntryNonces = pgTable(
  'web_auth_entry_nonces',
  {
    nonce: varchar('nonce', { length: 128 }).primaryKey(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    lineGroupId: varchar('line_group_id', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('web_auth_entry_nonce_expiry_idx').on(table.expiresAt),
    index('web_auth_entry_nonce_user_idx').on(table.lineUserId),
  ],
);
