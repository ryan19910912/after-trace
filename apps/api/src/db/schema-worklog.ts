import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const worklogSourceTypeEnum = pgEnum('worklog_source_type', ['PRIVATE', 'GROUP']);
export const worklogSourceStatusEnum = pgEnum('worklog_source_status', ['ACTIVE', 'INACTIVE']);
export const worklogSourceMemberRoleEnum = pgEnum('worklog_source_member_role', ['OWNER', 'MEMBER']);
export const worklogRecordInputTypeEnum = pgEnum('worklog_record_input_type', [
  'TEXT',
  'AUDIO',
  'IMAGE',
  'FILE',
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
export const worklogPlanTypeEnum = pgEnum('worklog_plan_type', ['FREE', 'SUBSCRIPTION', 'ONE_TIME']);
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
    // Nullable during migration so future Web/PWA accounts are not required to have LINE identity.
    lineUserId: varchar('line_user_id', { length: 64 }).unique('worklog_user_line_user_uq'),
    displayName: varchar('display_name', { length: 255 }),
    isOaFriend: boolean('is_oa_friend').default(false).notNull(),
    firstOaAddedAt: timestamp('first_oa_added_at', { withTimezone: true }),
    oaFriendStateAt: timestamp('oa_friend_state_at', { withTimezone: true }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_user_oa_updated_idx').on(table.isOaFriend, table.updatedAt)],
);

/**
 * Transitional storage container retained while bootstrap/auth still carry workspace_id.
 * Universal Record semantics, GROUP authorization and AI funding must not depend on the
 * workspace owner. The Source-centric rebuild can remove this storage parent in a later
 * schema batch without changing customer authorization semantics.
 */
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

/**
 * Durable PRIVATE/GROUP data boundary.
 *
 * Target GROUP authorization is native AFTERTRACE membership. line_group_id remains only
 * as a legacy migration identity; a native GROUP instead carries a non-empty name and no
 * LINE group id.
 */
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
    name: varchar('name', { length: 255 }),
    createdByUserId: bigint('created_by_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    lineGroupId: varchar('line_group_id', { length: 64 }).unique('worklog_source_line_group_uq'),
    inactiveAt: timestamp('inactive_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_source_private_user_uq').on(table.privateUserId),
    unique('worklog_source_private_user_id_uq').on(table.privateUserId, table.id),
    index('worklog_source_workspace_type_idx').on(table.workspaceId, table.type),
    index('worklog_source_creator_idx').on(table.createdByUserId),
    check(
      'worklog_source_identity_shape_ck',
      sql`(
        (${table.type} = 'PRIVATE' AND ${table.privateUserId} IS NOT NULL AND ${table.lineGroupId} IS NULL)
        OR
        (${table.type} = 'GROUP' AND ${table.privateUserId} IS NULL AND (
          ${table.lineGroupId} IS NOT NULL
          OR (${table.name} IS NOT NULL AND length(btrim(${table.name})) > 0)
        ))
      )`,
    ),
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
    role: worklogSourceMemberRoleEnum('role').default('MEMBER').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_source_member_uq').on(table.sourceId, table.userId),
    index('worklog_source_member_user_active_idx').on(table.userId, table.isActive),
    index('worklog_source_member_source_role_idx').on(table.sourceId, table.role, table.isActive),
  ],
);

/**
 * Commercial offer template. Legacy grant_points remains for historical accounting while
 * the target paid-AI product moves to per-user subscription-period hard caps.
 */
export const worklogSubscriptionPlans = pgTable(
  'worklog_subscription_plans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: varchar('code', { length: 64 }).notNull().unique('worklog_subscription_plan_code_uq'),
    planType: worklogPlanTypeEnum('plan_type').notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    priceTwd: numeric('price_twd', { precision: 12, scale: 2 }).default('0').notNull(),
    rank: integer('rank').default(0).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    grantPoints: integer('grant_points').default(0).notNull(),
    aiEnabled: boolean('ai_enabled').default(false).notNull(),
    monthlyAiPointCap: integer('monthly_ai_point_cap'),
    monthlyProviderCostCapTwd: numeric('monthly_provider_cost_cap_twd', {
      precision: 12,
      scale: 2,
    }),
    perRequestAiPointCap: integer('per_request_ai_point_cap'),
    capabilities: jsonb('capabilities').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'worklog_plan_free_identity_ck',
      sql`(
        (${table.code} = 'FREE' AND ${table.planType} = 'FREE' AND ${table.priceTwd} = 0)
        OR
        (${table.code} <> 'FREE' AND ${table.planType} <> 'FREE')
      )`,
    ),
    check('worklog_plan_grant_points_ck', sql`${table.grantPoints} >= 0`),
    check(
      'worklog_plan_ai_cap_values_ck',
      sql`(
        (${table.monthlyAiPointCap} IS NULL OR ${table.monthlyAiPointCap} > 0)
        AND (${table.monthlyProviderCostCapTwd} IS NULL OR ${table.monthlyProviderCostCapTwd} > 0)
        AND (${table.perRequestAiPointCap} IS NULL OR ${table.perRequestAiPointCap} > 0)
      )`,
    ),
    check(
      'worklog_plan_ai_enabled_shape_ck',
      sql`(
        ${table.aiEnabled} = FALSE
        OR (
          ${table.planType} = 'SUBSCRIPTION'
          AND ${table.priceTwd} > 0
          AND ${table.monthlyAiPointCap} IS NOT NULL
          AND ${table.monthlyProviderCostCapTwd} IS NOT NULL
        )
      )`,
    ),
  ],
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