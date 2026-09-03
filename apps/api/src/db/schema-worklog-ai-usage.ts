import { bigint, bigserial, index, integer, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers, worklogWorkspaces } from './schema-worklog';
import { worklogRecords } from './schema-worklog-record-core';

/**
 * Durable provider/accounting facts for each successful AI request.
 *
 * Provider usage/cost is immutable factual accounting. Customer points and platform
 * subsidy are separate settlement facts: customer_points_charged can never exceed the
 * eligible balance available to the already-started request, while any remainder is
 * retained as platform_subsidized_points/cost rather than customer overdraw.
 *
 * ai_units_consumed remains transitional until every executable caller has moved from
 * the legacy aggregate quota repository to the grant ledger.
 */
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
    operation: varchar('operation', { length: 64 }).default('UNKNOWN').notNull(),
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
    customerPointsCharged: integer('customer_points_charged').default(0).notNull(),
    platformSubsidizedPoints: integer('platform_subsidized_points').default(0).notNull(),
    platformSubsidizedCostUsd: numeric('platform_subsidized_cost_usd', { precision: 18, scale: 8 }).default('0').notNull(),
    platformSubsidizedCostTwd: numeric('platform_subsidized_cost_twd', { precision: 18, scale: 6 }),
    aiUnitsConsumed: integer('ai_units_consumed').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_ai_usage_actor_time_idx').on(table.actorUserId, table.createdAt),
    index('worklog_ai_usage_charged_time_idx').on(table.chargedUserId, table.createdAt),
    index('worklog_ai_usage_source_actor_time_idx').on(table.sourceId, table.actorUserId, table.createdAt),
    index('worklog_ai_usage_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('worklog_ai_usage_operation_time_idx').on(table.operation, table.createdAt),
    index('worklog_ai_usage_record_idx').on(table.recordId),
  ],
);
