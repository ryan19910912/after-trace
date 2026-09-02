import {
  bigint,
  bigserial,
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';

/**
 * A LINE group can be observed before AFTERTRACE can reliably identify who added the bot.
 * Keep that identity outside worklog_sources until an owner/workspace is known; this avoids
 * inventing ownership merely because some member happened to speak first.
 */
export const worklogPendingGroups = pgTable(
  'worklog_pending_groups',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    lineGroupId: varchar('line_group_id', { length: 64 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    inactiveAt: timestamp('inactive_at', { withTimezone: true }),
    promotedSourceId: bigint('promoted_source_id', { mode: 'number' }).references(() => worklogSources.id, {
      onDelete: 'restrict',
    }),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_pending_group_line_group_uq').on(table.lineGroupId),
    index('worklog_pending_group_active_updated_idx').on(table.isActive, table.updatedAt),
    index('worklog_pending_group_promoted_idx').on(table.promotedSourceId),
  ],
);

export const worklogPendingGroupMembers = pgTable(
  'worklog_pending_group_members',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    pendingGroupId: bigint('pending_group_id', { mode: 'number' })
      .notNull()
      .references(() => worklogPendingGroups.id, { onDelete: 'restrict' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').default(true).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_pending_group_member_uq').on(table.pendingGroupId, table.userId),
    index('worklog_pending_group_member_user_active_idx').on(table.userId, table.isActive),
  ],
);
