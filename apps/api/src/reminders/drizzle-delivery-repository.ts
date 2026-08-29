import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ReminderDeliveryRepository,
  ReminderDispatchAuthorization,
  ReminderDispatchClaim,
} from './delivery';
import type {
  ReminderDeliveryStatus,
  ReminderMutationResult,
} from './service';

const RETRY_KEY_WINDOW_MS = 23 * 60 * 60 * 1000;
const REMINDER_REFERENCE_TYPE = 'REMINDER';

type ClaimRow = {
  reminder_id: string;
  group_id: string;
  line_group_id: string;
  message: string;
  delivery_attempt_count: number;
  delivery_retry_key: string;
  delivery_retry_expires_at: Date | string;
};

type StatusRow = { status: ReminderDispatchAuthorization };
type MutationRow = { status: ReminderDeliveryStatus; reminder_id: string | null };

export class DrizzleReminderDeliveryRepository implements ReminderDeliveryRepository {
  constructor(private readonly db: Database) {}

  async claimDue(at: Date, leaseExpiresAt: Date, retryKey: string): Promise<ReminderDispatchClaim | null> {
    const retryExpiresAt = new Date(at.getTime() + RETRY_KEY_WINDOW_MS);
    const result = await this.db.execute(sql`
      WITH due AS MATERIALIZED (
        SELECT reminder.id
        FROM reminders AS reminder
        JOIN line_groups AS line_group ON line_group.id = reminder.group_id
        JOIN credit_reservations AS reservation
          ON reservation.group_id = reminder.group_id
         AND reservation.reference_type = ${REMINDER_REFERENCE_TYPE}
         AND reservation.reference_id = reminder.request_key
        WHERE reminder.status = 'SCHEDULED'
          AND reminder.scheduled_for <= ${at}
          AND line_group.status = 'ACTIVE'
          AND reservation.status = 'RESERVED'
          AND (
            reminder.delivery_lease_expires_at IS NULL
            OR reminder.delivery_lease_expires_at <= ${at}
          )
          AND (
            reminder.delivery_retry_expires_at IS NULL
            OR reminder.delivery_retry_expires_at > ${at}
          )
        ORDER BY reminder.scheduled_for, reminder.id
        FOR UPDATE OF reminder SKIP LOCKED
        LIMIT 1
      ),
      claimed AS (
        UPDATE reminders AS reminder
        SET delivery_attempt_count = reminder.delivery_attempt_count + 1,
            delivery_retry_key = COALESCE(reminder.delivery_retry_key, ${retryKey}),
            delivery_retry_expires_at = COALESCE(reminder.delivery_retry_expires_at, ${retryExpiresAt}),
            delivery_lease_expires_at = ${leaseExpiresAt},
            updated_at = ${at}
        FROM due
        WHERE reminder.id = due.id
        RETURNING reminder.*
      )
      SELECT
        claimed.id::text AS reminder_id,
        claimed.group_id::text AS group_id,
        line_group.line_group_id,
        claimed.message,
        claimed.delivery_attempt_count,
        claimed.delivery_retry_key,
        claimed.delivery_retry_expires_at
      FROM claimed
      JOIN line_groups AS line_group ON line_group.id = claimed.group_id
    `);

    const row = result.rows[0] as ClaimRow | undefined;
    if (!row) return null;
    return {
      reminderId: Number(row.reminder_id),
      groupId: Number(row.group_id),
      lineGroupId: row.line_group_id,
      message: row.message,
      attemptCount: row.delivery_attempt_count,
      retryKey: row.delivery_retry_key,
      retryKeyExpiresAt: new Date(row.delivery_retry_expires_at),
    };
  }

  async authorizeDispatch(
    claim: ReminderDispatchClaim,
    at: Date,
  ): Promise<ReminderDispatchAuthorization> {
    const result = await this.db.execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT reminder.id, reminder.status, line_group.status AS group_status
        FROM reminders AS reminder
        JOIN line_groups AS line_group ON line_group.id = reminder.group_id
        WHERE reminder.id = ${claim.reminderId}
          AND reminder.group_id = ${claim.groupId}
        FOR UPDATE OF reminder
      ),
      authorized AS (
        UPDATE reminders AS reminder
        SET status = 'DISPATCHING', updated_at = ${at}
        FROM locked
        WHERE reminder.id = locked.id
          AND locked.status = 'SCHEDULED'
          AND locked.group_status = 'ACTIVE'
          AND reminder.delivery_attempt_count = ${claim.attemptCount}
          AND reminder.delivery_retry_key = ${claim.retryKey}
          AND reminder.delivery_lease_expires_at > ${at}
        RETURNING reminder.id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM authorized) THEN 'AUTHORIZED'
        WHEN EXISTS (SELECT 1 FROM locked WHERE status = 'CANCELLED') THEN 'CANCELLED'
        WHEN EXISTS (SELECT 1 FROM locked WHERE group_status <> 'ACTIVE') THEN 'INACTIVE'
        ELSE 'STALE'
      END AS status
    `);
    return (result.rows[0] as StatusRow | undefined)?.status ?? 'STALE';
  }

  async releaseForRetry(claim: ReminderDispatchClaim, at: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE reminders
      SET status = 'SCHEDULED',
          delivery_lease_expires_at = ${at},
          updated_at = ${at}
      WHERE id = ${claim.reminderId}
        AND group_id = ${claim.groupId}
        AND status = 'DISPATCHING'
        AND delivery_attempt_count = ${claim.attemptCount}
        AND delivery_retry_key = ${claim.retryKey}
        AND delivery_retry_expires_at > ${at}
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async settleAccepted(
    claim: ReminderDispatchClaim,
    deliveryReference: string,
    at: Date,
  ): Promise<ReminderMutationResult<ReminderDeliveryStatus>> {
    const result = await this.db.execute(sql`
      WITH locked_reminder AS MATERIALIZED (
        SELECT id, request_key, status, delivery_reference,
               delivery_attempt_count, delivery_retry_key
        FROM reminders
        WHERE id = ${claim.reminderId}
          AND group_id = ${claim.groupId}
        FOR UPDATE
      ),
      locked_reservation AS MATERIALIZED (
        SELECT reservation.id, reservation.amount_cost_twd, reservation.status
        FROM credit_reservations AS reservation
        JOIN locked_reminder AS reminder ON reservation.reference_id = reminder.request_key
        WHERE reservation.group_id = ${claim.groupId}
          AND reservation.reference_type = ${REMINDER_REFERENCE_TYPE}
        FOR UPDATE
      ),
      existing_operation AS MATERIALIZED (
        SELECT operation.id
        FROM credit_operations AS operation
        JOIN locked_reminder AS reminder ON operation.reference_id = reminder.request_key
        WHERE operation.group_id = ${claim.groupId}
          AND operation.type = 'CONSUME'
          AND operation.reference_type = ${REMINDER_REFERENCE_TYPE}
        LIMIT 1
      ),
      transitioned AS (
        UPDATE credit_reservations AS reservation
        SET status = 'CONSUMED', updated_at = ${at}
        FROM locked_reservation, locked_reminder
        WHERE reservation.id = locked_reservation.id
          AND locked_reminder.status = 'DISPATCHING'
          AND locked_reminder.delivery_attempt_count = ${claim.attemptCount}
          AND locked_reminder.delivery_retry_key = ${claim.retryKey}
          AND locked_reservation.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        RETURNING reservation.amount_cost_twd
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id, type, scope_bucket, requested_amount_cost_twd,
          reference_type, reference_id, created_at
        )
        SELECT ${claim.groupId}, 'CONSUME', 'PAID', transitioned.amount_cost_twd,
               ${REMINDER_REFERENCE_TYPE}, reminder.request_key, ${at}
        FROM transitioned
        CROSS JOIN locked_reminder AS reminder
        ON CONFLICT DO NOTHING
        RETURNING id, requested_amount_cost_twd
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id, group_id, bucket, type, amount_cost_twd, created_at
        )
        SELECT id, ${claim.groupId}, 'PAID', 'CONSUME', requested_amount_cost_twd, ${at}
        FROM new_operation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET reserved_cost_twd = account.reserved_cost_twd - ledger.amount_cost_twd,
            updated_at = ${at}
        FROM ledger
        WHERE account.group_id = ${claim.groupId}
          AND account.bucket = 'PAID'
          AND account.reserved_cost_twd >= ledger.amount_cost_twd
        RETURNING ledger.operation_id
      ),
      reminder_mutation AS (
        UPDATE reminders AS reminder
        SET status = 'DELIVERED',
            delivery_reference = ${deliveryReference},
            delivered_at = ${at},
            delivery_lease_expires_at = NULL,
            updated_at = ${at}
        FROM account_mutation
        WHERE reminder.id = ${claim.reminderId}
          AND reminder.group_id = ${claim.groupId}
          AND reminder.status = 'DISPATCHING'
          AND reminder.delivery_attempt_count = ${claim.attemptCount}
          AND reminder.delivery_retry_key = ${claim.retryKey}
        RETURNING reminder.id
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id, actor_line_user_id, action, target_type, target_id, after_value, created_at
        )
        SELECT ${claim.groupId}, NULL, 'REMINDER_DELIVERED', 'REMINDER', reminder.id::text,
               jsonb_build_object(
                 'deliveryReference', ${deliveryReference},
                 'retryKey', ${claim.retryKey},
                 'attemptCount', ${claim.attemptCount}
               ), ${at}
        FROM reminder_mutation AS reminder
        RETURNING id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM locked_reminder) THEN 'NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM locked_reminder
          WHERE status = 'DELIVERED' AND delivery_reference = ${deliveryReference}
        ) THEN 'ALREADY_DELIVERED'
        WHEN EXISTS (SELECT 1 FROM locked_reminder WHERE status = 'CANCELLED') THEN 'ALREADY_CANCELLED'
        WHEN EXISTS (SELECT 1 FROM reminder_mutation) THEN 'DELIVERED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      (SELECT id::text FROM locked_reminder LIMIT 1) AS reminder_id
    `);

    const row = result.rows[0] as MutationRow | undefined;
    if (!row) throw new Error('reminder delivery settlement returned no result');
    return {
      status: row.status,
      reminderId: row.reminder_id === null ? null : Number(row.reminder_id),
    };
  }
}
