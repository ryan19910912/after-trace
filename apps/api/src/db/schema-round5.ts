import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  numeric,
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

export const rewardedAdGrantStatusEnum = pgEnum('rewarded_ad_grant_status', [
  'PENDING',
  'GRANTED',
  'REJECTED_POLICY',
]);

export const welcomeCreditUserState = pgTable('welcome_credit_user_state', {
  lineUserId: varchar('line_user_id', { length: 64 }).primaryKey(),
  groupCount: integer('group_count').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const welcomeCreditAttributions = pgTable(
  'welcome_credit_attributions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    isFirstGroup: boolean('is_first_group').default(false).notNull(),
    amountCostTwd: numeric('amount_cost_twd', { precision: 18, scale: 8 }).default('0').notNull(),
    grantOperationId: bigint('grant_operation_id', { mode: 'number' }).unique(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('welcome_credit_group_uq').on(table.groupId),
    index('welcome_credit_user_created_idx').on(table.lineUserId, table.createdAt),
  ],
);

export const rewardedAdPolicyState = pgTable(
  'rewarded_ad_policy_state',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    policyDay: varchar('policy_day', { length: 10 }).notNull(),
    grantCount: integer('grant_count').default(0).notNull(),
    lastAcceptedAt: timestamp('last_accepted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('rewarded_ad_policy_group_day_uq').on(table.groupId, table.policyDay),
  ],
);

export const rewardedAdGrants = pgTable(
  'rewarded_ad_grants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    actorLineUserId: varchar('actor_line_user_id', { length: 64 }).notNull(),
    rewardEventId: varchar('reward_event_id', { length: 128 }).notNull(),
    policyDay: varchar('policy_day', { length: 10 }).notNull(),
    amountCostTwd: numeric('amount_cost_twd', { precision: 18, scale: 8 }).notNull(),
    status: rewardedAdGrantStatusEnum('status').default('PENDING').notNull(),
    grantOperationId: bigint('grant_operation_id', { mode: 'number' }).unique(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('rewarded_ad_group_event_uq').on(table.groupId, table.rewardEventId),
    index('rewarded_ad_group_day_status_idx').on(table.groupId, table.policyDay, table.status),
  ],
);

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
