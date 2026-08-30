import {
  bigint,
  bigserial,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const memoryRequestOriginEnum = pgEnum('memory_request_origin', [
  'EXPLICIT',
  'AUTOMATIC',
]);

export const memoryRequestStatusEnum = pgEnum('memory_request_status', [
  'PENDING',
  'BLOCKED_SOURCE_MISSING',
  'CLAIMED',
  'SUCCEEDED',
  'FAILED',
]);

export const memoryCandidateRequests = pgTable(
  'memory_candidate_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    origin: memoryRequestOriginEnum('origin').notNull(),
    status: memoryRequestStatusEnum('status').default('PENDING').notNull(),
    extractionBatchId: bigint('extraction_batch_id', { mode: 'number' }),
    requestLineMessageId: varchar('request_line_message_id', { length: 64 }),
    actorLineUserId: varchar('actor_line_user_id', { length: 64 }),
    sourceLineMessageId: varchar('source_line_message_id', { length: 64 }),
    sourceConversationMessageId: bigint('source_conversation_message_id', { mode: 'number' }),
    instruction: text('instruction'),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('memory_request_explicit_line_message_uq').on(
      table.groupId,
      table.requestLineMessageId,
    ),
    index('memory_request_group_status_idx').on(table.groupId, table.status),
    index('memory_request_extraction_batch_idx').on(table.extractionBatchId),
  ],
);
