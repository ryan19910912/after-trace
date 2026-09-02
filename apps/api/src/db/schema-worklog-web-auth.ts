import { bigint, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';

// The physical table keeps its historical name so GROUP one-time links remain
// deployment-compatible while the ownership of the schema moves into Worklog.
export const worklogGroupWebEntryNonces = pgTable(
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

export const worklogPrivateWebEntryNonces = pgTable(
  'worklog_private_web_entry_nonces',
  {
    nonce: varchar('nonce', { length: 128 }).primaryKey(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
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
