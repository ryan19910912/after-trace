import {
  bigint,
  bigserial,
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

export const platformAiBudgetReservationStatusEnum = pgEnum(
  'platform_ai_budget_reservation_status',
  ['RESERVED', 'SETTLED', 'RELEASED'],
);

export const platformAiBudgetReservations = pgTable(
  'platform_ai_budget_reservations',
  {
    requestId: bigint('request_id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    budgetKey: varchar('budget_key', { length: 64 }).default('V1_FREE_AI').notNull(),
    reservedCostTwd: numeric('reserved_cost_twd', { precision: 18, scale: 8 }).notNull(),
    actualSubsidyCostTwd: numeric('actual_subsidy_cost_twd', { precision: 18, scale: 8 }),
    status: platformAiBudgetReservationStatusEnum('status').default('RESERVED').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('platform_ai_budget_reservation_status_idx').on(table.budgetKey, table.status)],
);

export const commerceEventStatusEnum = pgEnum('commerce_event_status', ['APPLIED', 'REJECTED']);

export const commerceProviderEvents = pgTable(
  'commerce_provider_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 160 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    status: commerceEventStatusEnum('status').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('commerce_provider_event_uq').on(table.provider, table.providerEventId),
    index('commerce_provider_event_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const userSubscriptionState = pgTable(
  'user_subscription_state',
  {
    userId: bigint('user_id', { mode: 'number' }).primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerSubscriptionId: varchar('provider_subscription_id', { length: 160 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: varchar('cancel_at_period_end', { length: 8 }).default('false').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('user_subscription_provider_subscription_uq').on(table.provider, table.providerSubscriptionId)],
);

export const userCheckoutIntents = pgTable(
  'user_checkout_intents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    requestKey: varchar('request_key', { length: 128 }).notNull(),
    productCode: varchar('product_code', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }),
    providerCheckoutId: varchar('provider_checkout_id', { length: 160 }),
    status: varchar('status', { length: 32 }).default('PENDING_PROVIDER').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_checkout_intent_request_uq').on(table.userId, table.requestKey),
    index('user_checkout_intent_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const explicitAiChatRequests = pgTable(
  'explicit_ai_chat_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    lineMessageId: varchar('line_message_id', { length: 64 }).notNull(),
    prompt: text('prompt').notNull(),
    status: varchar('status', { length: 32 }).default('PENDING').notNull(),
    responseText: text('response_text'),
    provider: varchar('provider', { length: 32 }),
    model: varchar('model', { length: 128 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costTwd: numeric('cost_twd', { precision: 18, scale: 8 }),
    energyUnits: bigint('energy_units', { mode: 'bigint' }),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('explicit_ai_chat_line_message_uq').on(table.groupId, table.lineMessageId),
    index('explicit_ai_chat_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const explicitAiEnergyHolds = pgTable(
  'explicit_ai_energy_holds',
  {
    requestId: bigint('request_id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    reservedUnits: bigint('reserved_units', { mode: 'bigint' }).notNull(),
    actualUnits: bigint('actual_units', { mode: 'bigint' }),
    status: varchar('status', { length: 32 }).default('RESERVED').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('explicit_ai_energy_hold_user_status_idx').on(table.userId, table.status)],
);

export const explicitAiEnergyHoldAllocations = pgTable(
  'explicit_ai_energy_hold_allocations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    lotId: bigint('lot_id', { mode: 'number' }).notNull(),
    units: bigint('units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('explicit_ai_energy_hold_allocation_uq').on(table.requestId, table.lotId),
    index('explicit_ai_energy_hold_lot_idx').on(table.lotId),
  ],
);
