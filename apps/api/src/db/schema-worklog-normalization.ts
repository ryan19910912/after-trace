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

/**
 * Durable orchestration state for post-persistence Worklog AI normalization.
 *
 * This table deliberately sits beside worklog_records instead of turning the raw
 * record itself into a transient job queue. A single row per record gives LINE
 * redelivery an idempotent state machine and lets a partially completed provider /
 * quota settlement be resumed without calling the provider a second time.
 */
export const worklogRecordAiNormalizations = pgTable(
  'worklog_record_ai_normalizations',
  {
    recordId: bigint('record_id', { mode: 'number' }).primaryKey(),
    status: varchar('status', { length: 32 }).default('PENDING').notNull(),
    claimToken: varchar('claim_token', { length: 64 }).notNull(),
    reservationToken: varchar('reservation_token', { length: 64 }),
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
