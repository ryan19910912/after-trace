import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { worklogCheckoutIntents } from './schema-worklog-checkout';
import { worklogUsers } from './schema-worklog';

/** Provider-specific current adapter state. One row per user. */
export const worklogNewebpaySubscriptions = pgTable(
  'worklog_newebpay_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => worklogUsers.id, { onDelete: 'restrict' }),
    checkoutIntentId: bigint('checkout_intent_id', { mode: 'number' }).references(() => worklogCheckoutIntents.id, { onDelete: 'restrict' }),
    merchantOrderNo: varchar('merchant_order_no', { length: 30 }).notNull(),
    periodNo: varchar('period_no', { length: 32 }),
    status: varchar('status', { length: 32 }).default('PENDING').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    lastProviderEventKey: varchar('last_provider_event_key', { length: 255 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_newebpay_subscription_user_uq').on(table.userId),
    uniqueIndex('worklog_newebpay_subscription_order_uq').on(table.merchantOrderNo),
    uniqueIndex('worklog_newebpay_subscription_period_uq').on(table.periodNo),
    index('worklog_newebpay_subscription_status_time_idx').on(table.status, table.updatedAt),
    check('worklog_newebpay_subscription_status_ck', sql`${table.status} IN ('PENDING','ACTIVE','TERMINATED','FAILED')`),
  ],
);

/**
 * Durable NewebPay agreement/order history.
 *
 * Current state remains one row per user in worklog_newebpay_subscriptions. Every merchant
 * order is retained here so delayed provider callbacks can still be reconciled after a newer
 * checkout has replaced the current PENDING row.
 */
export const worklogNewebpaySubscriptionHistory = pgTable(
  'worklog_newebpay_subscription_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => worklogUsers.id, { onDelete: 'restrict' }),
    checkoutIntentId: bigint('checkout_intent_id', { mode: 'number' }).references(() => worklogCheckoutIntents.id, { onDelete: 'restrict' }),
    merchantOrderNo: varchar('merchant_order_no', { length: 30 }).notNull(),
    periodNo: varchar('period_no', { length: 32 }),
    status: varchar('status', { length: 32 }).default('PENDING').notNull(),
    providerStatus: varchar('provider_status', { length: 64 }),
    respondCode: varchar('respond_code', { length: 64 }),
    authAmount: integer('auth_amount'),
    totalTimes: integer('total_times'),
    alreadyTimes: integer('already_times'),
    tradeNo: varchar('trade_no', { length: 64 }),
    authDate: timestamp('auth_date', { withTimezone: true }),
    nextAuthDate: timestamp('next_auth_date', { withTimezone: true }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    lastProviderEventKey: varchar('last_provider_event_key', { length: 255 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_newebpay_history_order_uq').on(table.merchantOrderNo),
    uniqueIndex('worklog_newebpay_history_period_uq').on(table.periodNo),
    index('worklog_newebpay_history_user_time_idx').on(table.userId, table.updatedAt),
    index('worklog_newebpay_history_status_time_idx').on(table.status, table.updatedAt),
    check(
      'worklog_newebpay_history_status_ck',
      sql`${table.status} IN ('PENDING','ACTIVE','TERMINATED','FAILED','SUPERSEDED','PAID_CONFLICT')`,
    ),
  ],
);
