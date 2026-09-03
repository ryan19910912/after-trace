import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogRecords } from './schema-worklog-record-core';
import { worklogAiQuotaReservations } from './schema-worklog-quota';

/**
 * Durable orchestration state for post-persistence Worklog AI interpretation.
 *
 * The historical table name is retained while the current output is still being
 * migrated from legacy summary/category normalization to CREATE/EDIT/HISTORY title
 * and occurred-at interpretation. A single row per Record keeps provider execution
 * and settlement idempotent across LINE redelivery.
 */
export const worklogRecordAiNormalizations = pgTable(
  'worklog_record_ai_normalizations',
  {
    recordId: bigint('record_id', { mode: 'number' })
      .primaryKey()
      .references(() => worklogRecords.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 32 }).default('PENDING').notNull(),
    claimToken: varchar('claim_token', { length: 64 }).notNull(),
    reservationToken: varchar('reservation_token', { length: 64 }).references(
      () => worklogAiQuotaReservations.token,
      { onDelete: 'restrict' },
    ),
    resultJson: jsonb('result_json'),
    usageCommitJson: jsonb('usage_commit_json'),
    providerResponseId: varchar('provider_response_id', { length: 255 }),
    latencyMs: integer('latency_ms'),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    lastErrorDetail: text('last_error_detail'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    providerSucceededAt: timestamp('provider_succeeded_at', { withTimezone: true }),
    usageCommittedAt: timestamp('usage_committed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_record_ai_normalization_claim_uq').on(table.claimToken),
    index('worklog_record_ai_normalization_status_idx').on(table.status, table.updatedAt),
    index('worklog_record_ai_normalization_reservation_idx').on(table.reservationToken),
    check(
      'worklog_record_ai_normalization_status_check',
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'PROVIDER_SUCCEEDED', 'USAGE_COMMITTED', 'SUCCEEDED', 'FAILED')`,
    ),
  ],
);
