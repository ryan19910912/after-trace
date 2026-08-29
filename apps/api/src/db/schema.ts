import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const groupStatusEnum = pgEnum('group_status', ['ACTIVE', 'INACTIVE']);
export const creditBucketEnum = pgEnum('credit_bucket', ['WELCOME', 'AD', 'PAID']);
export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', [
  'GRANT',
  'CONSUME',
  'RESERVE',
  'RELEASE',
]);
export const creditReservationStatusEnum = pgEnum('credit_reservation_status', [
  'RESERVED',
  'CONSUMED',
  'RELEASED',
]);
export const memoryStatusEnum = pgEnum('memory_status', ['ACTIVE', 'SUPERSEDED']);
export const extractionBatchStatusEnum = pgEnum('extraction_batch_status', [
  'CLAIMED',
  'SUCCEEDED',
  'FAILED',
]);

export const lineUsers = pgTable('line_users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  lineUserId: varchar('line_user_id', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const lineGroups = pgTable('line_groups', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  lineGroupId: varchar('line_group_id', { length: 64 }).notNull().unique(),
  status: groupStatusEnum('status').default('ACTIVE').notNull(),
  hasPaid: boolean('has_paid').default(false).notNull(),
  pendingMessageCount: integer('pending_message_count').default(0).notNull(),
  pendingCharCount: integer('pending_char_count').default(0).notNull(),
  inactiveAt: timestamp('inactive_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('group_member_group_user_uq').on(table.groupId, table.lineUserId),
    index('group_member_user_idx').on(table.lineUserId),
  ],
);

export const conversationExtractionBatches = pgTable(
  'conversation_extraction_batches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    status: extractionBatchStatusEnum('status').default('CLAIMED').notNull(),
    activeClaimKey: varchar('active_claim_key', { length: 16 }),
    messageCount: integer('message_count').notNull(),
    charCount: integer('char_count').notNull(),
    firstMessageId: bigint('first_message_id', { mode: 'number' }).notNull(),
    lastMessageId: bigint('last_message_id', { mode: 'number' }).notNull(),
    attemptCount: integer('attempt_count').default(1).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('extraction_batch_active_claim_uq').on(table.groupId, table.activeClaimKey),
    index('extraction_batch_group_status_idx').on(table.groupId, table.status),
    index('extraction_batch_lease_idx').on(table.leaseExpiresAt),
  ],
);

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    webhookEventId: varchar('webhook_event_id', { length: 128 }),
    lineMessageId: varchar('line_message_id', { length: 64 }).notNull(),
    quotedLineMessageId: varchar('quoted_line_message_id', { length: 64 }),
    lineUserId: varchar('line_user_id', { length: 64 }),
    messageType: varchar('message_type', { length: 32 }).notNull(),
    textContent: text('text_content'),
    charCount: integer('char_count').default(0).notNull(),
    quoteToken: text('quote_token'),
    lineTimestamp: timestamp('line_timestamp', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata'),
    extractionBatchId: bigint('extraction_batch_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('conversation_message_line_id_uq').on(table.lineMessageId),
    index('conversation_message_group_created_idx').on(table.groupId, table.createdAt),
    index('conversation_message_group_line_time_idx').on(table.groupId, table.lineTimestamp),
    index('conversation_message_quoted_line_id_idx').on(table.quotedLineMessageId),
    index('conversation_message_extraction_batch_idx').on(table.extractionBatchId),
  ],
);

export const memories = pgTable(
  'memories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    subject: text('subject'),
    content: text('content').notNull(),
    status: memoryStatusEnum('status').default('ACTIVE').notNull(),
    sourceMessageId: varchar('source_message_id', { length: 64 }),
    sourceQuoteToken: text('source_quote_token'),
    sourceLineUserId: varchar('source_line_user_id', { length: 64 }),
    sourceLineTimestamp: timestamp('source_line_timestamp', { withTimezone: true }),
    metadata: jsonb('metadata'),
    supersededById: bigint('superseded_by_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('memory_group_status_idx').on(table.groupId, table.status)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    actorLineUserId: varchar('actor_line_user_id', { length: 64 }),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 128 }),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_group_created_idx').on(table.groupId, table.createdAt)],
);

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    bucket: creditBucketEnum('bucket').notNull(),
    availableCostTwd: numeric('available_cost_twd', { precision: 18, scale: 8 }).default('0').notNull(),
    reservedCostTwd: numeric('reserved_cost_twd', { precision: 18, scale: 8 }).default('0').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('credit_account_group_bucket_uq').on(table.groupId, table.bucket)],
);

export const creditOperations = pgTable(
  'credit_operations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    type: creditTransactionTypeEnum('type').notNull(),
    scopeBucket: creditBucketEnum('scope_bucket'),
    requestedAmountCostTwd: numeric('requested_amount_cost_twd', { precision: 18, scale: 8 }).notNull(),
    referenceType: varchar('reference_type', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('credit_operation_reference_uq').on(
      table.groupId,
      table.type,
      table.referenceType,
      table.referenceId,
    ),
    index('credit_operation_group_created_idx').on(table.groupId, table.createdAt),
  ],
);

export const creditReservations = pgTable(
  'credit_reservations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    reserveOperationId: bigint('reserve_operation_id', { mode: 'number' }).notNull().unique(),
    referenceType: varchar('reference_type', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 128 }).notNull(),
    amountCostTwd: numeric('amount_cost_twd', { precision: 18, scale: 8 }).notNull(),
    status: creditReservationStatusEnum('status').default('RESERVED').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('credit_reservation_reference_uq').on(
      table.groupId,
      table.referenceType,
      table.referenceId,
    ),
    index('credit_reservation_group_status_idx').on(table.groupId, table.status),
  ],
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    operationId: bigint('operation_id', { mode: 'number' }).notNull(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    bucket: creditBucketEnum('bucket').notNull(),
    type: creditTransactionTypeEnum('type').notNull(),
    amountCostTwd: numeric('amount_cost_twd', { precision: 18, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('credit_transaction_operation_bucket_uq').on(table.operationId, table.bucket),
    index('credit_transaction_group_created_idx').on(table.groupId, table.createdAt),
  ],
);

export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }),
    usageType: varchar('usage_type', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }).default('GOOGLE').notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    inputUsdPerMillionTokens: numeric('input_usd_per_million_tokens', { precision: 18, scale: 10 }).notNull(),
    outputUsdPerMillionTokens: numeric('output_usd_per_million_tokens', { precision: 18, scale: 10 }).notNull(),
    costUsd: numeric('cost_usd', { precision: 18, scale: 10 }).notNull(),
    usdTwdRate: numeric('usd_twd_rate', { precision: 12, scale: 6 }).notNull(),
    costTwd: numeric('cost_twd', { precision: 18, scale: 8 }).notNull(),
    chargedCostTwd: numeric('charged_cost_twd', { precision: 18, scale: 8 }).notNull(),
    latencyMs: integer('latency_ms'),
    chargeOperationId: bigint('charge_operation_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ai_usage_charge_operation_uq').on(table.chargeOperationId),
    index('ai_usage_group_created_idx').on(table.groupId, table.createdAt),
  ],
);
