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
export const memoryStatusEnum = pgEnum('memory_status', ['ACTIVE', 'SUPERSEDED']);

export const lineUsers = pgTable('line_users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  lineUserId: varchar('line_user_id', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    lineMessageId: varchar('line_message_id', { length: 64 }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }),
    messageType: varchar('message_type', { length: 32 }).notNull(),
    textContent: text('text_content'),
    charCount: integer('char_count').default(0).notNull(),
    quoteToken: text('quote_token'),
    batchSequence: integer('batch_sequence'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('conversation_message_line_id_uq').on(table.lineMessageId),
    index('conversation_message_group_created_idx').on(table.groupId, table.createdAt),
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

export const aiUsageEvents = pgTable('ai_usage_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  groupId: bigint('group_id', { mode: 'number' }).notNull(),
  lineUserId: varchar('line_user_id', { length: 64 }),
  usageType: varchar('usage_type', { length: 64 }).notNull(),
  provider: varchar('provider', { length: 32 }).default('GOOGLE').notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  inputTokens: integer('input_tokens').default(0).notNull(),
  outputTokens: integer('output_tokens').default(0).notNull(),
  costUsd: numeric('cost_usd', { precision: 18, scale: 10 }).notNull(),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

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

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    bucket: creditBucketEnum('bucket').notNull(),
    type: creditTransactionTypeEnum('type').notNull(),
    amountCostTwd: numeric('amount_cost_twd', { precision: 18, scale: 8 }).notNull(),
    referenceType: varchar('reference_type', { length: 64 }),
    referenceId: varchar('reference_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('credit_transaction_group_created_idx').on(table.groupId, table.createdAt)],
);
