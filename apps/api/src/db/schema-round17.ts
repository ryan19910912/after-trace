import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const automaticMemoryEligibleSubjects = pgTable(
  'automatic_memory_eligible_subjects',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    extractionBatchId: bigint('extraction_batch_id', { mode: 'number' }).notNull(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    normalizedCharCount: integer('normalized_char_count').notNull(),
    preflightAvailableUnits: bigint('preflight_available_units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('automatic_memory_eligible_request_user_uq').on(table.requestId, table.userId),
    index('automatic_memory_eligible_batch_idx').on(table.extractionBatchId),
    index('automatic_memory_eligible_group_request_idx').on(table.groupId, table.requestId),
  ],
);

export const aiUserEnergyAllocations = pgTable(
  'ai_user_energy_allocations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    lineUserId: varchar('line_user_id', { length: 64 }).notNull(),
    allocatedUnits: bigint('allocated_units', { mode: 'bigint' }).notNull(),
    chargedUnits: bigint('charged_units', { mode: 'bigint' }).notNull(),
    platformSubsidyUnits: bigint('platform_subsidy_units', { mode: 'bigint' }).notNull(),
    chargeOperationId: bigint('charge_operation_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ai_user_energy_allocation_request_user_uq').on(table.requestId, table.userId),
    index('ai_user_energy_allocation_group_created_idx').on(table.groupId, table.createdAt),
  ],
);

export const platformAiSubsidyOperations = pgTable(
  'platform_ai_subsidy_operations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    units: bigint('units', { mode: 'bigint' }).notNull(),
    budgetKey: varchar('budget_key', { length: 64 }).default('V1_FREE_AI').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('platform_ai_subsidy_request_user_uq').on(table.requestId, table.userId),
    index('platform_ai_subsidy_budget_created_idx').on(table.budgetKey, table.createdAt),
  ],
);

export const userReminderOwnership = pgTable(
  'user_reminder_ownership',
  {
    reminderId: bigint('reminder_id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    groupId: bigint('group_id', { mode: 'number' }).notNull(),
    energyReservationId: bigint('energy_reservation_id', { mode: 'number' }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('user_reminder_owner_group_idx').on(table.userId, table.groupId),
  ],
);
