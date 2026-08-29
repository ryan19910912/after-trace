import {
  bigint,
  index,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const globalFreeAiBudgetState = pgTable('global_free_ai_budget_state', {
  budgetKey: varchar('budget_key', { length: 64 }).primaryKey(),
  spentCostTwd: numeric('spent_cost_twd', { precision: 18, scale: 8 }).default('0').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const globalFreeAiBudgetOperations = pgTable(
  'global_free_ai_budget_operations',
  {
    creditOperationId: bigint('credit_operation_id', { mode: 'number' }).primaryKey(),
    budgetKey: varchar('budget_key', { length: 64 }).notNull(),
    freeCostTwd: numeric('free_cost_twd', { precision: 18, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('global_free_ai_budget_operation_key_idx').on(table.budgetKey, table.createdAt)],
);
