import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { worklogCheckoutIntents } from './schema-worklog-checkout';
import { worklogUsers } from './schema-worklog';

/** Provider-specific adapter state only; core entitlement remains provider-neutral. */
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
