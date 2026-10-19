import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogRecords } from './schema-worklog-record-core';
import { worklogSources, worklogUsers } from './schema-worklog';

export const worklogTaskStatusEnum = (name: string) => varchar(name, { length: 32 });

/**
 * User-confirmed durable task/reminder state. Domain validation and state-transition rules
 * belong to the application layer; PostgreSQL stores the resulting state only.
 */
export const worklogTasks = pgTable(
  'worklog_tasks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'cascade' }),
    sourceId: bigint('source_id', { mode: 'number' }).references(() => worklogSources.id, { onDelete: 'set null' }),
    recordId: bigint('record_id', { mode: 'number' }).references(() => worklogRecords.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    status: worklogTaskStatusEnum('status').default('OPEN').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    remindAt: timestamp('remind_at', { withTimezone: true }),
    reminderNotifiedAt: timestamp('reminder_notified_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_task_user_status_idx').on(table.userId, table.status, table.createdAt),
    index('worklog_task_due_reminder_idx').on(table.status, table.remindAt, table.reminderNotifiedAt),
    index('worklog_task_source_idx').on(table.sourceId, table.status),
  ],
);
