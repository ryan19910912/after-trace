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

export const worklogSourceTypeEnum = pgEnum('worklog_source_type', ['PRIVATE', 'GROUP']);
export const worklogSourceStatusEnum = pgEnum('worklog_source_status', ['ACTIVE', 'INACTIVE']);
export const worklogRecordInputTypeEnum = pgEnum('worklog_record_input_type', [
  'TEXT',
  'AUDIO',
  'IMAGE',
  'FILE',
]);
export const worklogRecordCategoryEnum = pgEnum('worklog_record_category', [
  'NOTE',
  'WORK',
  'ISSUE',
  'PAYMENT',
  'EXPENSE',
  'MATERIAL',
  'PHOTO',
  'AUDIO',
  'OTHER',
]);
export const worklogProjectStatusEnum = pgEnum('worklog_project_status', [
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
]);
export const worklogTransactionTypeEnum = pgEnum('worklog_transaction_type', [
  'RECEIVED',
  'EXPENSE',
  'RECEIVABLE',
]);
export const worklogSubscriptionStatusEnum = pgEnum('worklog_subscription_status', [
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
]);
export const worklogSubscriptionSourceEnum = pgEnum('worklog_subscription_source', [
  'FREE',
  'PAYMENT',
  'ADMIN',
]);
export const worklogFeedbackChannelEnum = pgEnum('worklog_feedback_channel', ['LINE_OA', 'PWA']);
export const worklogAnomalySeverityEnum = pgEnum('worklog_anomaly_severity', [
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);
export const worklogAnomalyStatusEnum = pgEnum('worklog_anomaly_status', [
  'OPEN',
  'RESOLVED',
  'IGNORED',
]);

export const worklogUsers = pgTable(
  'worklog_users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    isOaFriend: boolean('is_oa_friend').default(false).notNull(),
    firstOaAddedAt: timestamp('first_oa_added_at', { withTimezone: true }),
    oaFriendStateAt: timestamp('oa_friend_state_at', { withTimezone: true }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_user_line_user_uq').on(table.lineUserId),
    index('worklog_user_oa_updated_idx').on(table.isOaFriend, table.updatedAt),
  ],
);

export const worklogWorkspaces = pgTable(
  'worklog_workspaces',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: bigint('owner_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('worklog_workspace_owner_uq').on(table.ownerUserId)],
);

export const worklogSources = pgTable(
  'worklog_sources',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => worklogWorkspaces.id, { onDelete: 'restrict' }),
    type: worklogSourceTypeEnum('type').notNull(),
    status: worklogSourceStatusEnum('status').default('ACTIVE').notNull(),
    privateUserId: bigint('private_user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    lineGroupId: varchar('line_group_id', { length: 64 }),
    ownerUserId: bigint('owner_user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    ownerBindingMethod: varchar('owner_binding_method', { length: 64 }),
    ownerBoundAt: timestamp('owner_bound_at', { withTimezone: true }),
    subscriptionOwnerUserId: bigint('subscription_owner_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    inactiveAt: timestamp('inactive_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_source_private_user_uq').on(table.privateUserId),
    uniqueIndex('worklog_source_line_group_uq').on(table.lineGroupId),
    index('worklog_source_workspace_type_idx').on(table.workspaceId, table.type),
    index('worklog_source_owner_idx').on(table.ownerUserId),
    index('worklog_source_subscription_owner_idx').on(table.subscriptionOwnerUserId),
  ],
);

export const worklogSourceMembers = pgTable(
  'worklog_source_members',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').default(true).notNull(),
    recordingEnabled: boolean('recording_enabled').default(true).notNull(),
    recordingUpdatedByUserId: bigint('recording_updated_by_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    recordingUpdatedAt: timestamp('recording_updated_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_source_member_uq').on(table.sourceId, table.userId),
    index('worklog_source_member_user_active_idx').on(table.userId, table.isActive),
    index('worklog_source_member_source_recording_idx').on(
      table.sourceId,
      table.isActive,
      table.recordingEnabled,
    ),
  ],
);

export const worklogCustomers = pgTable(
  'worklog_customers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => worklogWorkspaces.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 64 }),
    address: text('address'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_customer_workspace_name_idx').on(table.workspaceId, table.name)],
);

export const worklogProjects = pgTable(
  'worklog_projects',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => worklogWorkspaces.id, { onDelete: 'restrict' }),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => worklogCustomers.id, {
      onDelete: 'restrict',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    address: text('address'),
    status: worklogProjectStatusEnum('status').default('ACTIVE').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_project_workspace_status_idx').on(table.workspaceId, table.status),
    index('worklog_project_customer_idx').on(table.customerId),
  ],
);

export const worklogRecords = pgTable(
  'worklog_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => worklogWorkspaces.id, { onDelete: 'restrict' }),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    authorUserId: bigint('author_user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => worklogCustomers.id, {
      onDelete: 'restrict',
    }),
    projectId: bigint('project_id', { mode: 'number' }).references(() => worklogProjects.id, {
      onDelete: 'restrict',
    }),
    lineMessageId: varchar('line_message_id', { length: 64 }),
    quotedLineMessageId: varchar('quoted_line_message_id', { length: 64 }),
    inputType: worklogRecordInputTypeEnum('input_type').notNull(),
    category: worklogRecordCategoryEnum('category').default('OTHER').notNull(),
    rawText: text('raw_text'),
    attachmentMetadata: jsonb('attachment_metadata'),
    normalizedSummary: text('normalized_summary'),
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_record_line_message_uq').on(table.lineMessageId),
    index('worklog_record_source_created_idx').on(table.sourceId, table.createdAt),
    index('worklog_record_workspace_customer_idx').on(table.workspaceId, table.customerId),
    index('worklog_record_workspace_project_idx').on(table.workspaceId, table.projectId),
    index('worklog_record_author_type_idx').on(table.authorUserId, table.inputType),
    index('worklog_record_source_author_type_idx').on(table.sourceId, table.authorUserId, table.inputType),
  ],
);

export const worklogTransactions = pgTable(
  'worklog_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => worklogWorkspaces.id, { onDelete: 'restrict' }),
    recordId: bigint('record_id', { mode: 'number' }).references(() => worklogRecords.id, {
      onDelete: 'restrict',
    }),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => worklogCustomers.id, {
      onDelete: 'restrict',
    }),
    projectId: bigint('project_id', { mode: 'number' }).references(() => worklogProjects.id, {
      onDelete: 'restrict',
    }),
    type: worklogTransactionTypeEnum('type').notNull(),
    amountTwd: numeric('amount_twd', { precision: 14, scale: 2 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_transaction_workspace_time_idx').on(table.workspaceId, table.occurredAt),
    index('worklog_transaction_project_idx').on(table.projectId),
    index('worklog_transaction_record_idx').on(table.recordId),
  ],
);

export const worklogSubscriptionPlans = pgTable(
  'worklog_subscription_plans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: varchar('code', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    priceTwd: numeric('price_twd', { precision: 12, scale: 2 }).default('0').notNull(),
    rank: integer('rank').default(0).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    aiAllowanceUnits: integer('ai_allowance_units').default(0).notNull(),
    capabilities: jsonb('capabilities').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('worklog_subscription_plan_code_uq').on(table.code)],
);

export const worklogUserSubscriptions = pgTable(
  'worklog_user_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    planCode: varchar('plan_code', { length: 64 })
      .notNull()
      .references(() => worklogSubscriptionPlans.code, { onDelete: 'restrict' }),
    status: worklogSubscriptionStatusEnum('status').default('ACTIVE').notNull(),
    source: worklogSubscriptionSourceEnum('source').default('FREE').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).defaultNow().notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_user_subscription_user_uq').on(table.userId),
    index('worklog_user_subscription_plan_status_idx').on(table.planCode, table.status),
  ],
);

export const worklogSubscriptionHistory = pgTable(
  'worklog_subscription_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    previousPlanCode: varchar('previous_plan_code', { length: 64 }).references(
      () => worklogSubscriptionPlans.code,
      { onDelete: 'restrict' },
    ),
    nextPlanCode: varchar('next_plan_code', { length: 64 })
      .notNull()
      .references(() => worklogSubscriptionPlans.code, { onDelete: 'restrict' }),
    source: worklogSubscriptionSourceEnum('source').notNull(),
    actor: varchar('actor', { length: 128 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_subscription_history_user_time_idx').on(table.userId, table.createdAt)],
);

export const worklogAiRuntimeConfig = pgTable('worklog_ai_runtime_config', {
  id: integer('id').primaryKey().default(1),
  provider: varchar('provider', { length: 128 }).notNull(),
  model: varchar('model', { length: 255 }).notNull(),
  inputUsdPerMillion: numeric('input_usd_per_million', { precision: 18, scale: 8 }).notNull(),
  outputUsdPerMillion: numeric('output_usd_per_million', { precision: 18, scale: 8 }).notNull(),
  audioUsdPerMillion: numeric('audio_usd_per_million', { precision: 18, scale: 8 }),
  imageUsdPerMillion: numeric('image_usd_per_million', { precision: 18, scale: 8 }),
  usdTwdRate: numeric('usd_twd_rate', { precision: 12, scale: 6 }),
  updatedBy: varchar('updated_by', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const worklogAiUsageEvents = pgTable(
  'worklog_ai_usage_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: bigint('actor_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    chargedUserId: bigint('charged_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    workspaceId: bigint('workspace_id', { mode: 'number' }).references(() => worklogWorkspaces.id, {
      onDelete: 'restrict',
    }),
    sourceId: bigint('source_id', { mode: 'number' }).references(() => worklogSources.id, {
      onDelete: 'restrict',
    }),
    recordId: bigint('record_id', { mode: 'number' }).references(() => worklogRecords.id, {
      onDelete: 'restrict',
    }),
    provider: varchar('provider', { length: 128 }).notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    audioInputUnits: integer('audio_input_units').default(0).notNull(),
    imageInputUnits: integer('image_input_units').default(0).notNull(),
    inputUsdPerMillion: numeric('input_usd_per_million', { precision: 18, scale: 8 }).notNull(),
    outputUsdPerMillion: numeric('output_usd_per_million', { precision: 18, scale: 8 }).notNull(),
    audioUsdPerMillion: numeric('audio_usd_per_million', { precision: 18, scale: 8 }),
    imageUsdPerMillion: numeric('image_usd_per_million', { precision: 18, scale: 8 }),
    usdTwdRate: numeric('usd_twd_rate', { precision: 12, scale: 6 }),
    providerCostUsd: numeric('provider_cost_usd', { precision: 18, scale: 8 }).notNull(),
    providerCostTwd: numeric('provider_cost_twd', { precision: 18, scale: 6 }),
    aiUnitsConsumed: integer('ai_units_consumed').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_ai_usage_actor_time_idx').on(table.actorUserId, table.createdAt),
    index('worklog_ai_usage_charged_time_idx').on(table.chargedUserId, table.createdAt),
    index('worklog_ai_usage_source_actor_time_idx').on(table.sourceId, table.actorUserId, table.createdAt),
    index('worklog_ai_usage_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('worklog_ai_usage_record_idx').on(table.recordId),
  ],
);

export const worklogFeedback = pgTable(
  'worklog_feedback',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    displayNameSnapshot: varchar('display_name_snapshot', { length: 255 }),
    channel: worklogFeedbackChannelEnum('channel').notNull(),
    text: text('text').notNull(),
    context: jsonb('context'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_feedback_created_idx').on(table.createdAt)],
);

export const worklogAnomalyEvents = pgTable(
  'worklog_anomaly_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    category: varchar('category', { length: 128 }).notNull(),
    severity: worklogAnomalySeverityEnum('severity').default('ERROR').notNull(),
    status: worklogAnomalyStatusEnum('status').default('OPEN').notNull(),
    errorCode: varchar('error_code', { length: 128 }),
    summary: text('summary').notNull(),
    userId: bigint('user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    sourceId: bigint('source_id', { mode: 'number' }).references(() => worklogSources.id, {
      onDelete: 'restrict',
    }),
    lineMessageId: varchar('line_message_id', { length: 64 }),
    requestRef: varchar('request_ref', { length: 255 }),
    metadata: jsonb('metadata'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_anomaly_status_severity_time_idx').on(table.status, table.severity, table.createdAt),
    index('worklog_anomaly_user_idx').on(table.userId),
  ],
);

export const worklogAuditLogs = pgTable(
  'worklog_audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' }).references(() => worklogWorkspaces.id, {
      onDelete: 'restrict',
    }),
    actorUserId: bigint('actor_user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    actorAdmin: varchar('actor_admin', { length: 128 }),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 128 }),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_audit_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('worklog_audit_target_idx').on(table.targetType, table.targetId),
  ],
);
