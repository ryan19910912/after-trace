import {
  bigint,
  bigserial,
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

export const reminderStatusEnum = pgEnum('reminder_status', [
  'SCHEDULED',
  'DISPATCHING',
  'CANCELLED',
  'DELIVERED',
]);

export const reminders = pgTable(
  'reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    requestKey: varchar('request_key', { length: 128 }).notNull(),
    message: text('message').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: reminderStatusEnum('status').default('SCHEDULED').notNull(),
    // Legacy Group-credit field. New User-Energy reminders store zero here and use
    // user_reminder_ownership -> user_energy_reservations for financial ownership.
    reservedCostTwd: numeric('reserved_cost_twd', { precision: 18, scale: 8 }).default('0').notNull(),
    // Nullable for new User-Energy reminders. Legacy rows retain their credit operation id.
    reserveOperationId: bigint('reserve_operation_id', { mode: 'number' }).unique(),
    createdByLineUserId: varchar('created_by_line_user_id', { length: 64 }).notNull(),
    cancelledByLineUserId: varchar('cancelled_by_line_user_id', { length: 64 }),
    deliveryReference: varchar('delivery_reference', { length: 128 }),
    deliveryAttemptCount: integer('delivery_attempt_count').default(0).notNull(),
    deliveryRetryKey: varchar('delivery_retry_key', { length: 36 }),
    deliveryRetryExpiresAt: timestamp('delivery_retry_expires_at', { withTimezone: true }),
    deliveryLeaseExpiresAt: timestamp('delivery_lease_expires_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reminder_group_request_key_uq').on(table.groupId, table.requestKey),
    index('reminder_group_status_scheduled_idx').on(
      table.groupId,
      table.status,
      table.scheduledFor,
    ),
    index('reminder_due_idx').on(table.status, table.scheduledFor, table.deliveryLeaseExpiresAt),
  ],
);
