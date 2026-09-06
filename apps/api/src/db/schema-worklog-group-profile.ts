import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { worklogSources } from './schema-worklog';

/**
 * Cached LINE-owned presentation metadata for GROUP Sources.
 *
 * AFTERTRACE does not maintain a separate custom group display name. The source of truth
 * remains LINE; this table only avoids calling the LINE group-summary API on every use.
 */
export const worklogSourceLineProfiles = pgTable(
  'worklog_source_line_profiles',
  {
    sourceId: bigint('source_id', { mode: 'number' })
      .primaryKey()
      .references(() => worklogSources.id, { onDelete: 'cascade' }),
    groupName: text('group_name').notNull(),
    pictureUrl: text('picture_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_source_line_profile_synced_idx').on(table.syncedAt)],
);
