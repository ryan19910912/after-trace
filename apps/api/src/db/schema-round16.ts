import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const energyBucketEnum = pgEnum('energy_bucket', [
  'FREE',
  'SUBSCRIPTION',
  'AD',
  'PAID',
]);

export const energyOperationTypeEnum = pgEnum('energy_operation_type', [
  'GRANT',
  'CONSUME',
  'RESERVE',
  'RELEASE',
  'RESERVED_CONSUME',
]);

export const energyReservationStatusEnum = pgEnum('energy_reservation_status', [
  'RESERVED',
  'RELEASED',
  'CONSUMED',
]);

export const paidPackCodeEnum = pgEnum('paid_pack_code', ['SMALL', 'MEDIUM', 'LARGE']);

export const userEnergyLots = pgTable(
  'user_energy_lots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    bucket: energyBucketEnum('bucket').notNull(),
    originalUnits: bigint('original_units', { mode: 'bigint' }).notNull(),
    availableUnits: bigint('available_units', { mode: 'bigint' }).notNull(),
    reservedUnits: bigint('reserved_units', { mode: 'bigint' }).default(sql`0`).notNull(),
    sourceType: varchar('source_type', { length: 64 }).notNull(),
    sourceId: varchar('source_id', { length: 160 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_energy_lot_source_uq').on(
      table.userId,
      table.bucket,
      table.sourceType,
      table.sourceId,
    ),
    index('user_energy_lot_spend_idx').on(table.userId, table.expiresAt, table.bucket),
  ],
);

export const userEnergyOperations = pgTable(
  'user_energy_operations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    type: energyOperationTypeEnum('type').notNull(),
    requestedUnits: bigint('requested_units', { mode: 'bigint' }).notNull(),
    referenceType: varchar('reference_type', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 160 }).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_energy_operation_reference_uq').on(
      table.userId,
      table.type,
      table.referenceType,
      table.referenceId,
    ),
    index('user_energy_operation_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const userEnergyTransactions = pgTable(
  'user_energy_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    operationId: bigint('operation_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    lotId: bigint('lot_id', { mode: 'number' }).notNull(),
    bucket: energyBucketEnum('bucket').notNull(),
    type: energyOperationTypeEnum('type').notNull(),
    units: bigint('units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_energy_transaction_operation_lot_uq').on(table.operationId, table.lotId),
    index('user_energy_transaction_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const userEnergyReservations = pgTable(
  'user_energy_reservations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    reserveOperationId: bigint('reserve_operation_id', { mode: 'number' }).notNull().unique(),
    referenceType: varchar('reference_type', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 160 }).notNull(),
    requestedUnits: bigint('requested_units', { mode: 'bigint' }).notNull(),
    status: energyReservationStatusEnum('status').default('RESERVED').notNull(),
    validThrough: timestamp('valid_through', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_energy_reservation_reference_uq').on(
      table.userId,
      table.referenceType,
      table.referenceId,
    ),
    index('user_energy_reservation_user_status_idx').on(table.userId, table.status),
  ],
);

export const userEnergyReservationAllocations = pgTable(
  'user_energy_reservation_allocations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reservationId: bigint('reservation_id', { mode: 'number' }).notNull(),
    lotId: bigint('lot_id', { mode: 'number' }).notNull(),
    units: bigint('units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_energy_reservation_allocation_lot_uq').on(table.reservationId, table.lotId),
    index('user_energy_reservation_allocation_lot_idx').on(table.lotId),
  ],
);

export const userSubscriptionCycles = pgTable(
  'user_subscription_cycles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    subscriptionId: varchar('subscription_id', { length: 160 }).notNull(),
    cycleId: varchar('cycle_id', { length: 160 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    grantOperationId: bigint('grant_operation_id', { mode: 'number' }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_subscription_cycle_provider_uq').on(table.provider, table.cycleId),
    index('user_subscription_cycle_user_period_idx').on(table.userId, table.periodEnd),
  ],
);

export const userPaidPurchases = pgTable(
  'user_paid_purchases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerPurchaseId: varchar('provider_purchase_id', { length: 160 }).notNull(),
    packCode: paidPackCodeEnum('pack_code').notNull(),
    grantOperationId: bigint('grant_operation_id', { mode: 'number' }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_paid_purchase_provider_uq').on(table.provider, table.providerPurchaseId),
    index('user_paid_purchase_user_created_idx').on(table.userId, table.createdAt),
  ],
);
