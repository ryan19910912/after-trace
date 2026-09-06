import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { worklogUsers } from './schema-worklog';

/**
 * One short-lived private-OA interaction mode per user.
 *
 * Rich Menu selection is a durable request boundary: the next valid text is either
 * RECORD input or QUERY input. Cloudflare Worker memory must never own this state.
 */
export const worklogPrivatePendingActions = pgTable(
  'worklog_private_pending_actions',
  {
    userId: bigint('user_id', { mode: 'number' })
      .primaryKey()
      .references(() => worklogUsers.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 16 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_private_pending_action_expiry_idx').on(table.expiresAt),
    check(
      'worklog_private_pending_action_type_ck',
      sql`${table.action} IN ('RECORD', 'QUERY')`,
    ),
  ],
);
