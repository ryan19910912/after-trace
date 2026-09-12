import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { worklogSubscriptionPlans, worklogUsers } from './schema-worklog';

export const worklogCheckoutIntents = pgTable(
  'worklog_checkout_intents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    planCode: varchar('plan_code', { length: 64 })
      .notNull()
      .references(() => worklogSubscriptionPlans.code, { onDelete: 'restrict' }),
    payerEmail: varchar('payer_email', { length: 320 }),
    requestKey: varchar('request_key', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).default('PENDING_PROVIDER').notNull(),
    provider: varchar('provider', { length: 64 }),
    providerCheckoutId: varchar('provider_checkout_id', { length: 255 }),
    checkoutUrl: varchar('checkout_url', { length: 2048 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_checkout_intent_request_uq').on(table.requestKey),
    index('worklog_checkout_intent_user_time_idx').on(table.userId, table.createdAt),
    index('worklog_checkout_intent_status_time_idx').on(table.status, table.createdAt),
    check('worklog_checkout_intent_status_ck', sql`${table.status} IN ('PENDING_PROVIDER','READY','COMPLETED','CANCELLED','FAILED')`),
  ],
);
