import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Singleton operator-owned commercial configuration that is not itself a customer balance.
 * Application services validate singleton ownership and positive business values.
 */
export const worklogCommercialConfig = pgTable('worklog_commercial_config', {
  id: integer('id').primaryKey().default(1),
  freeInitialAiTrialPoints: integer('free_initial_ai_trial_points').notNull(),
  updatedBy: varchar('updated_by', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
