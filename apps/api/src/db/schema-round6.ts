import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const memoryCandidateDecisionEnum = pgEnum('memory_candidate_decision', [
  'NEW',
  'DUPLICATE',
  'UPDATE',
  'CONTRADICT',
]);

export const automaticMemoryRequestKeys = pgTable(
  'automatic_memory_request_keys',
  {
    extractionBatchId: bigint('extraction_batch_id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('automatic_memory_request_request_uq').on(table.requestId),
    index('automatic_memory_request_group_idx').on(table.groupId),
  ],
);

export const memoryRequestWorkStates = pgTable(
  'memory_request_work_states',
  {
    requestId: bigint('request_id', { mode: 'number' }).primaryKey(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    transientFailureCount: integer('transient_failure_count').default(0).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('memory_request_work_lease_idx').on(table.leaseExpiresAt)],
);

export const memoryCandidateResults = pgTable(
  'memory_candidate_results',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    candidateIndex: integer('candidate_index').notNull(),
    decision: memoryCandidateDecisionEnum('decision').notNull(),
    targetMemoryId: bigint('target_memory_id', { mode: 'number' }),
    persistedMemoryId: bigint('persisted_memory_id', { mode: 'number' }).notNull(),
    sourceConversationMessageId: bigint('source_conversation_message_id', { mode: 'number' }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    subject: text('subject'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('memory_candidate_result_request_index_uq').on(
      table.requestId,
      table.candidateIndex,
    ),
    index('memory_candidate_result_memory_idx').on(table.persistedMemoryId),
    index('memory_candidate_result_target_idx').on(table.targetMemoryId),
  ],
);
