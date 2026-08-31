import { bigint, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sources } from './schema';

/**
 * Operational cadence/health for provider metadata synchronization.
 *
 * This is separate from `sources.updated_at`: the source row is upserted before
 * venue/sport metadata is fully applied, so `updated_at` cannot prove a whole
 * metadata refresh succeeded. Only this runtime row advances the success clock.
 */
export const sourceMetadataRuntime = pgTable(
  'source_metadata_runtime',
  {
    sourceId: bigint('source_id', { mode: 'number' })
      .primaryKey()
      .references(() => sources.id, { onDelete: 'cascade' }),
    lastSuccessfulAt: timestamp('last_successful_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('source_metadata_runtime_due_idx').on(table.nextAttemptAt, table.sourceId)],
);
