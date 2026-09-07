import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { worklogFeedback } from './schema-worklog';

/** Admin-only workflow state layered over durable in-product feedback content. */
export const worklogFeedbackManagement = pgTable(
  'worklog_feedback_management',
  {
    feedbackId: bigint('feedback_id', { mode: 'number' })
      .primaryKey()
      .references(() => worklogFeedback.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 32 }).default('OTHER').notNull(),
    status: varchar('status', { length: 32 }).default('OPEN').notNull(),
    updatedBy: varchar('updated_by', { length: 128 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('worklog_feedback_management_category_ck', sql`${table.category} IN ('BUG','FEATURE','UX','OTHER')`),
    check('worklog_feedback_management_status_ck', sql`${table.status} IN ('OPEN','IN_PROGRESS','RESOLVED','IGNORED')`),
    index('worklog_feedback_management_status_time_idx').on(table.status, table.updatedAt),
  ],
);
