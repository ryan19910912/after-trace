import { bigint, bigserial, index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { worklogUsers } from './schema-worklog';

/**
 * Provider-neutral external subscription event inbox.
 *
 * Payment adapters translate their webhook payloads into AFTERTRACE lifecycle events.
 * provider + external_event_key is the durable idempotency boundary; raw card/payment
 * credentials never belong here.
 */
export const worklogSubscriptionLifecycleEvents = pgTable(
  'worklog_subscription_lifecycle_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: varchar('provider', { length: 64 }).notNull(),
    externalEventKey: varchar('external_event_key', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    planCode: varchar('plan_code', { length: 64 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_subscription_lifecycle_provider_event_uq').on(table.provider, table.externalEventKey),
    index('worklog_subscription_lifecycle_user_time_idx').on(table.userId, table.occurredAt),
    index('worklog_subscription_lifecycle_type_time_idx').on(table.eventType, table.occurredAt),
  ],
);
