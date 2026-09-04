import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';
import { worklogAiPointReservations } from './schema-worklog-grants';
import { worklogRecords } from './schema-worklog-record-core';

export const worklogAttachmentIngestions = pgTable(
  'worklog_attachment_ingestions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    commandLineMessageId: varchar('command_line_message_id', { length: 64 }).notNull(),
    quotedLineMessageId: varchar('quoted_line_message_id', { length: 64 }).notNull(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    actorUserId: bigint('actor_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 32 }).notNull(),
    reservationToken: varchar('reservation_token', { length: 64 }).references(
      () => worklogAiPointReservations.token,
      { onDelete: 'restrict' },
    ),
    recordId: bigint('record_id', { mode: 'number' }),
    usageCommitJson: jsonb('usage_commit_json'),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('worklog_attachment_ingestion_command_uq').on(table.commandLineMessageId),
    index('worklog_attachment_ingestion_source_status_idx').on(table.sourceId, table.status),
    index('worklog_attachment_ingestion_quoted_idx').on(table.quotedLineMessageId),
    foreignKey({
      columns: [table.sourceId, table.recordId],
      foreignColumns: [worklogRecords.sourceId, worklogRecords.id],
      name: 'worklog_attachment_ingestion_source_record_fk',
    }).onDelete('restrict'),
    check('worklog_attachment_ingestion_status_ck', sql`${table.status} IN ('PROCESSING', 'RECORD_CREATED', 'SUCCEEDED', 'FAILED')`),
  ],
);
