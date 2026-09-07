import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  CreateTaskInput,
  DueTaskNotificationResult,
  TaskRepository,
  UpdateTaskInput,
  WorklogTask,
} from './tasks';

type TaskRow = {
  id: string;
  user_id: string;
  source_id: string | null;
  record_id: string | null;
  title: string;
  body: string | null;
  status: WorklogTask['status'];
  due_at: Date | string | null;
  remind_at: Date | string | null;
  reminder_notified_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: number, limit: number): Promise<WorklogTask[]> {
    const result = await this.db.execute(sql`
      SELECT task.id::text AS id,
             task.user_id::text AS user_id,
             task.source_id::text AS source_id,
             task.record_id::text AS record_id,
             task.title,
             task.body,
             task.status,
             task.due_at,
             task.remind_at,
             task.reminder_notified_at,
             task.completed_at,
             task.cancelled_at,
             task.created_at,
             task.updated_at
      FROM worklog_tasks AS task
      WHERE task.user_id = ${userId}
      ORDER BY COALESCE(task.remind_at, task.due_at, task.created_at) ASC, task.id ASC
      LIMIT ${limit}
    `);
    return (result.rows as TaskRow[]).map(taskRow);
  }

  async create(input: CreateTaskInput): Promise<WorklogTask> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_tasks (
        user_id, source_id, record_id, title, body,
        status, due_at, remind_at, created_at, updated_at
      )
      SELECT ${input.userId}, ${input.sourceId ?? null}, ${input.recordId ?? null}, ${input.title}, ${input.body ?? null},
             'OPEN', ${input.dueAt ?? null}, ${input.remindAt ?? null}, NOW(), NOW()
      WHERE (
        ${input.sourceId ?? null}::bigint IS NULL
        OR EXISTS (
          SELECT 1
          FROM worklog_source_members AS member
          INNER JOIN worklog_sources AS source ON source.id = member.source_id
          WHERE member.source_id = ${input.sourceId ?? null}
            AND member.user_id = ${input.userId}
            AND member.is_active = TRUE
            AND source.status = 'ACTIVE'
        )
      )
      AND (
        ${input.recordId ?? null}::bigint IS NULL
        OR EXISTS (
          SELECT 1
          FROM worklog_records AS record
          WHERE record.id = ${input.recordId ?? null}
            AND record.source_id = ${input.sourceId ?? null}
            AND record.status = 'ACTIVE'
        )
      )
      RETURNING id::text AS id
    `);
    const id = Number((result.rows[0] as { id?: string } | undefined)?.id);
    if (!id) throw new Error('TASK_SOURCE_NOT_AUTHORIZED');
    const task = await this.findForUser(input.userId, id);
    if (!task) throw new Error('TASK_CREATE_FAILED');
    return task;
  }

  async update(userId: number, taskId: number, input: UpdateTaskInput): Promise<WorklogTask | null> {
    const hasTitle = Object.prototype.hasOwnProperty.call(input, 'title');
    const hasBody = Object.prototype.hasOwnProperty.call(input, 'body');
    const hasDueAt = Object.prototype.hasOwnProperty.call(input, 'dueAt');
    const hasRemindAt = Object.prototype.hasOwnProperty.call(input, 'remindAt');
    const result = await this.db.execute(sql`
      UPDATE worklog_tasks AS task
      SET title = CASE WHEN ${hasTitle} THEN ${input.title ?? ''} ELSE task.title END,
          body = CASE WHEN ${hasBody} THEN ${input.body ?? null} ELSE task.body END,
          due_at = CASE WHEN ${hasDueAt} THEN ${input.dueAt ?? null} ELSE task.due_at END,
          remind_at = CASE WHEN ${hasRemindAt} THEN ${input.remindAt ?? null} ELSE task.remind_at END,
          reminder_notified_at = CASE
            WHEN ${hasRemindAt} AND task.remind_at IS DISTINCT FROM ${input.remindAt ?? null}
              THEN NULL
            ELSE task.reminder_notified_at
          END,
          updated_at = NOW()
      WHERE task.id = ${taskId}
        AND task.user_id = ${userId}
        AND task.status = 'OPEN'
      RETURNING task.id::text AS id
    `);
    if (!result.rows[0]) return null;
    return this.findForUser(userId, taskId);
  }

  async complete(userId: number, taskId: number): Promise<WorklogTask | null> {
    const result = await this.db.execute(sql`
      UPDATE worklog_tasks AS task
      SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
      WHERE task.id = ${taskId}
        AND task.user_id = ${userId}
        AND task.status = 'OPEN'
      RETURNING task.id::text AS id
    `);
    if (!result.rows[0]) return null;
    return this.findForUser(userId, taskId);
  }

  async cancel(userId: number, taskId: number): Promise<WorklogTask | null> {
    const result = await this.db.execute(sql`
      UPDATE worklog_tasks AS task
      SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
      WHERE task.id = ${taskId}
        AND task.user_id = ${userId}
        AND task.status = 'OPEN'
      RETURNING task.id::text AS id
    `);
    if (!result.rows[0]) return null;
    return this.findForUser(userId, taskId);
  }

  async dispatchDueReminderNotifications(limit: number): Promise<DueTaskNotificationResult> {
    const result = await this.db.execute(sql`
      WITH due_tasks AS MATERIALIZED (
        SELECT task.id
        FROM worklog_tasks AS task
        WHERE task.status = 'OPEN'
          AND task.remind_at IS NOT NULL
          AND task.remind_at <= NOW()
          AND task.reminder_notified_at IS NULL
        ORDER BY task.remind_at ASC, task.id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ), claimed_tasks AS MATERIALIZED (
        UPDATE worklog_tasks AS task
        SET reminder_notified_at = NOW(), updated_at = NOW()
        FROM due_tasks
        WHERE task.id = due_tasks.id
          AND task.status = 'OPEN'
          AND task.reminder_notified_at IS NULL
        RETURNING task.id, task.user_id, task.title, task.body
      ), inserted_notifications AS MATERIALIZED (
        INSERT INTO worklog_notifications (
          type, status, audience, title, body,
          in_app_enabled, push_enabled, reference_type, reference_id,
          deep_link, created_by_actor, sent_at, created_at, updated_at
        )
        SELECT 'TASK', 'SENT', 'SPECIFIC_USERS',
               '待辦提醒：' || claimed_tasks.title,
               COALESCE(claimed_tasks.body, claimed_tasks.title),
               TRUE, TRUE, 'TASK', claimed_tasks.id,
               '/tasks/' || claimed_tasks.id::text,
               'TASK_SCHEDULER', NOW(), NOW(), NOW()
        FROM claimed_tasks
        RETURNING id, reference_id
      ), inserted_recipients AS (
        INSERT INTO worklog_notification_recipients (
          notification_id, user_id, read_at, push_status, created_at, updated_at
        )
        SELECT inserted_notifications.id,
               claimed_tasks.user_id,
               NULL,
               'PENDING'::worklog_notification_delivery_status,
               NOW(), NOW()
        FROM inserted_notifications
        INNER JOIN claimed_tasks ON claimed_tasks.id = inserted_notifications.reference_id
        ON CONFLICT (notification_id, user_id) DO NOTHING
        RETURNING id
      )
      SELECT (SELECT COUNT(*)::int FROM due_tasks) AS examined,
             (SELECT COUNT(*)::int FROM inserted_notifications) AS notified
    `);
    const row = result.rows[0] as { examined?: number; notified?: number } | undefined;
    const examined = Number(row?.examined ?? 0);
    const notified = Number(row?.notified ?? 0);
    return { examined, notified, skipped: Math.max(0, examined - notified) };
  }

  private async findForUser(userId: number, taskId: number): Promise<WorklogTask | null> {
    const result = await this.db.execute(sql`
      SELECT task.id::text AS id,
             task.user_id::text AS user_id,
             task.source_id::text AS source_id,
             task.record_id::text AS record_id,
             task.title,
             task.body,
             task.status,
             task.due_at,
             task.remind_at,
             task.reminder_notified_at,
             task.completed_at,
             task.cancelled_at,
             task.created_at,
             task.updated_at
      FROM worklog_tasks AS task
      WHERE task.id = ${taskId}
        AND task.user_id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as TaskRow | undefined;
    return row ? taskRow(row) : null;
  }
}

function taskRow(row: TaskRow): WorklogTask {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    sourceId: row.source_id ? Number(row.source_id) : null,
    recordId: row.record_id ? Number(row.record_id) : null,
    title: row.title,
    body: row.body,
    status: row.status,
    dueAt: iso(row.due_at),
    remindAt: iso(row.remind_at),
    reminderNotifiedAt: iso(row.reminder_notified_at),
    completedAt: iso(row.completed_at),
    cancelledAt: iso(row.cancelled_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}
