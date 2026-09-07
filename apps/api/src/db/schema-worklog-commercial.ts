import { sql } from 'drizzle-orm';
import { check, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Singleton operator-owned commercial configuration that is not itself a customer balance.
 * The FREE trial quantity is snapshotted into each user's immutable FREE_INITIAL grant when
 * first issued; later config edits never resize historical grants.
 */
export const worklogCommercialConfig = pgTable(
  'worklog_commercial_config',
  {
    id: integer('id').primaryKey().default(1),
    freeInitialAiTrialPoints: integer('free_initial_ai_trial_points').notNull(),
    updatedBy: varchar('updated_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('worklog_commercial_config_singleton_ck', sql`${table.id} = 1`),
    check(
      'worklog_commercial_config_free_trial_points_ck',
      sql`${table.freeInitialAiTrialPoints} >= 0`,
    ),
  ],
);
