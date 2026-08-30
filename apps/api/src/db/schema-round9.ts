import { numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const globalFreeAiBudgetState = pgTable('global_free_ai_budget_state', {
  budgetKey: varchar('budget_key', { length: 64 }).primaryKey(),
  spentCostTwd: numeric('spent_cost_twd', { precision: 18, scale: 8 }).default('0').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
