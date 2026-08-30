import { bigint, index, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { notificationDeliveries } from './schema';

/**
 * Operational state for one notification delivery intent.
 *
 * The core delivery row remains the durable product/audit record while this
 * table owns retry leases and browser-presentation state. Keeping the lease
 * state separate avoids overloading delivery status/error fields with worker
 * coordination details.
 */
export const notificationDeliveryRuntime = pgTable(
  'notification_delivery_runtime',
  {
    deliveryId: bigint('delivery_id', { mode: 'number' })
      .primaryKey()
      .references(() => notificationDeliveries.id, { onDelete: 'cascade' }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    dispatchClaimKey: varchar('dispatch_claim_key', { length: 64 }),
    presentedAt: timestamp('presented_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notification_delivery_runtime_due_idx').on(table.nextAttemptAt, table.expiresAt, table.deliveryId),
    index('notification_delivery_runtime_presented_idx').on(table.presentedAt, table.deliveryId),
  ],
);
