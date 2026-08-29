import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ReminderRecoveryCommand,
  ReminderRecoveryRepository,
  ReminderRecoveryStatus,
} from './recovery';

type RecoveryRow = { status: ReminderRecoveryStatus };

export class DrizzleReminderRecoveryRepository implements ReminderRecoveryRepository {
  constructor(private readonly db: Database) {}

  async requeueUnresolved(command: ReminderRecoveryCommand): Promise<ReminderRecoveryStatus> {
    const result = await this.db.execute(sql`
      WITH locked_reminder AS MATERIALIZED (
        SELECT
          id,
          group_id,
          status,
          delivery_attempt_count,
          delivery_retry_key,
          delivery_retry_expires_at,
          delivery_lease_expires_at
        FROM reminders
        WHERE id = ${command.reminderId}
          AND group_id = ${command.groupId}
        FOR UPDATE
      ),
      requeued AS (
        UPDATE reminders AS reminder
        SET status = 'SCHEDULED',
            delivery_lease_expires_at = NULL,
            updated_at = ${command.at}
        FROM locked_reminder AS locked
        WHERE reminder.id = locked.id
          AND locked.status = 'DISPATCHING'
          AND locked.delivery_attempt_count = ${command.expectedAttemptCount}
          AND locked.delivery_retry_key = ${command.retryKey}
          AND locked.delivery_retry_expires_at > ${command.at}
          AND (
            locked.delivery_lease_expires_at IS NULL
            OR locked.delivery_lease_expires_at <= ${command.at}
          )
        RETURNING reminder.id
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id,
          actor_line_user_id,
          action,
          target_type,
          target_id,
          after_value,
          created_at
        )
        SELECT
          ${command.groupId},
          NULL,
          'REMINDER_DELIVERY_REQUEUED',
          'REMINDER',
          requeued.id::text,
          jsonb_build_object(
            'operatorRef', ${command.operatorRef},
            'reason', ${command.reason},
            'attemptCount', ${command.expectedAttemptCount},
            'retryKey', ${command.retryKey}
          ),
          ${command.at}
        FROM requeued
        RETURNING id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM locked_reminder) THEN 'NOT_FOUND'
        WHEN EXISTS (SELECT 1 FROM requeued) THEN 'REQUEUED'
        WHEN EXISTS (
          SELECT 1 FROM locked_reminder WHERE status <> 'DISPATCHING'
        ) THEN 'NOT_DISPATCHING'
        WHEN EXISTS (
          SELECT 1
          FROM locked_reminder
          WHERE delivery_attempt_count <> ${command.expectedAttemptCount}
             OR delivery_retry_key IS DISTINCT FROM ${command.retryKey}
        ) THEN 'STALE'
        WHEN EXISTS (
          SELECT 1
          FROM locked_reminder
          WHERE delivery_retry_expires_at IS NULL
             OR delivery_retry_expires_at <= ${command.at}
        ) THEN 'RETRY_KEY_EXPIRED'
        WHEN EXISTS (
          SELECT 1
          FROM locked_reminder
          WHERE delivery_lease_expires_at > ${command.at}
        ) THEN 'LEASE_ACTIVE'
        ELSE 'STALE'
      END AS status
    `);

    const row = result.rows[0] as RecoveryRow | undefined;
    if (!row) throw new Error('reminder recovery returned no result');
    return row.status;
  }
}
