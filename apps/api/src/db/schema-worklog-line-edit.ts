import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
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
import { worklogAiPointReservations } from './schema-worklog-grants';
import { worklogRecords } from './schema-worklog-record-core';
import { worklogSources, worklogUsers } from './schema-worklog';

/**
 * Exactly-once orchestration state for a Reply-targeted LINE AI edit command.
 *
 * The incoming LINE command message ID is the idempotency key. Provider output and
 * usage facts are persisted before grant settlement, so a webhook redelivery can
 * resume settlement/apply without issuing another provider request. PROCESSING rows
 * that become stale are treated as uncertain provider attempts and are never replayed.
 */
export const worklogLineAiEdits = pgTable(
  'worklog_line_ai_edits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    recordId: bigint('record_id', { mode: 'number' })
      .notNull()
      .references(() => worklogRecords.id, { onDelete: 'restrict' }),
    actorUserId: bigint('actor_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    chargedUserId: bigint('charged_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    lineCommandMessageId: varchar('line_command_message_id', { length: 64 }).notNull(),
    quotedLineMessageId: varchar('quoted_line_message_id', { length: 64 }).notNull(),
    instruction: text('instruction').notNull(),
    expectedRecordVersion: integer('expected_record_version').notNull(),
    status: varchar('status', { length: 32 }).default('PROCESSING').notNull(),
    claimToken: varchar('claim_token', { length: 64 }).notNull(),
    reservationToken: varchar('reservation_token', { length: 64 }).references(
      () => worklogAiPointReservations.token,
      { onDelete: 'restrict' },
    ),
    resultJson: jsonb('result_json'),
    usageCommitJson: jsonb('usage_commit_json'),
    providerResponseId: varchar('provider_response_id', { length: 255 }),
    latencyMs: integer('latency_ms'),
    confirmationId: bigint('confirmation_id', { mode: 'number' }),
    appliedRecordVersion: integer('applied_record_version'),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    lastErrorDetail: text('last_error_detail'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    providerSucceededAt: timestamp('provider_succeeded_at', { withTimezone: true }),
    usageCommittedAt: timestamp('usage_committed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_line_ai_edit_command_uq').on(table.lineCommandMessageId),
    uniqueIndex('worklog_line_ai_edit_claim_uq').on(table.claimToken),
    index('worklog_line_ai_edit_record_idx').on(table.recordId, table.createdAt),
    index('worklog_line_ai_edit_status_idx').on(table.status, table.updatedAt),
    index('worklog_line_ai_edit_reservation_idx').on(table.reservationToken),
    check('worklog_line_ai_edit_expected_version_check', sql`${table.expectedRecordVersion} > 0`),
    check(
      'worklog_line_ai_edit_status_check',
      sql`${table.status} IN ('PROCESSING', 'PROVIDER_SUCCEEDED', 'USAGE_COMMITTED', 'PENDING_CONFIRMATION', 'SUCCEEDED', 'RECORD_CHANGED', 'FAILED')`,
    ),
  ],
);
