import { bigint, bigserial, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { worklogRecords } from './schema-worklog-record-core';

/**
 * Durable bounded mapping from an AFTERTRACE bot success/result message back to the
 * Record it represents.
 *
 * LINE users may Reply to the bot's acknowledgement rather than to the original user
 * message. The Messaging API returns the sent bot message ID; persisting that ID lets
 * Reply-targeted edits resolve deterministically without guessing by text/time/author.
 */
export const worklogLineRecordReplyTargets = pgTable(
  'worklog_line_record_reply_targets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    recordId: bigint('record_id', { mode: 'number' })
      .notNull()
      .references(() => worklogRecords.id, { onDelete: 'restrict' }),
    botLineMessageId: varchar('bot_line_message_id', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_line_record_reply_target_message_uq').on(table.botLineMessageId),
    index('worklog_line_record_reply_target_record_idx').on(table.recordId, table.createdAt),
  ],
);
