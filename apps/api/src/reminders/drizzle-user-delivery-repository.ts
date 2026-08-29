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

type ClaimRow = {
  reminder_id: string;
  group_id: string;
  line_group_id: string;
  message: string;
  delivery_attempt_count: number;
  delivery_retry_key: string;
  delivery_retry_expires_at: Date | string;
};

type MutationRow = { status: ReminderDeliveryStatus; reminder_id: string | null };

export class DrizzleUserReminderDeliveryRepository implements ReminderDeliveryRepository {
  constructor(private readonly db: Database) {}

  async claimDue(at: Date, leaseExpiresAt: Date, retryKey: string): Promise<ReminderDispatchClaim | null> {
    const retryExpiresAt = new Date(at.getTime() + RETRY_KEY_WINDOW_MS);
    const result = await this.db.execute(sql`
      WITH due AS MATERIALIZED (
        SELECT reminder.id
        FROM reminders reminder
        JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
        JOIN user_energy_reservations reservation ON reservation.id = ownership.energy_reservation_id
        JOIN line_groups line_group ON line_group.id = reminder.group_id
        WHERE reminder.status = 'SCHEDULED'
          AND reminder.scheduled_for <= ${at}
          AND line_group.status = 'ACTIVE'
          AND reservation.status = 'RESERVED'
          AND (reminder.delivery_lease_expires_at IS NULL OR reminder.delivery_lease_expires_at <= ${at})
          AND (reminder.delivery_retry_expires_at IS NULL OR reminder.delivery_retry_expires_at > ${at})
        ORDER BY reminder.scheduled_for, reminder.id
        FOR UPDATE OF reminder SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE reminders reminder
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
      JOIN line_groups line_group ON line_group.id = claimed.group_id
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
        SELECT
          reminder.id,
          reminder.status,
          reminder.group_id,
          line_group.status AS group_status,
          ownership.user_id,
          ownership.energy_reservation_id,
          line_user.line_user_id,
          EXISTS (
            SELECT 1 FROM group_members member
            WHERE member.group_id = reminder.group_id
              AND member.line_user_id = line_user.line_user_id
              AND member.is_active = TRUE
          ) AS owner_active
        FROM reminders reminder
        JOIN line_groups line_group ON line_group.id = reminder.group_id
        JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
        JOIN line_users line_user ON line_user.id = ownership.user_id
        WHERE reminder.id = ${claim.reminderId}
          AND reminder.group_id = ${claim.groupId}
        FOR UPDATE OF reminder
      ), reservation AS MATERIALIZED (
        SELECT reservation.id, reservation.user_id, reservation.requested_units, reservation.status
        FROM user_energy_reservations reservation
        JOIN locked ON locked.energy_reservation_id = reservation.id
        FOR UPDATE OF reservation
      ), owner_left_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT
          reservation.user_id,
          'RELEASE',
          reservation.requested_units,
          'REMINDER_OWNER_LEFT',
          ${String(claim.reminderId)},
          jsonb_build_object('groupId', ${claim.groupId}),
          ${at}
        FROM reservation
        CROSS JOIN locked
        WHERE locked.status = 'SCHEDULED'
          AND locked.group_status = 'ACTIVE'
          AND locked.owner_active = FALSE
          AND reservation.status = 'RESERVED'
        ON CONFLICT DO NOTHING
        RETURNING id, user_id
      ), allocations AS MATERIALIZED (
        SELECT allocation.lot_id, allocation.units, lot.bucket
        FROM user_energy_reservation_allocations allocation
        JOIN reservation ON reservation.id = allocation.reservation_id
        JOIN user_energy_lots lot ON lot.id = allocation.lot_id
        FOR UPDATE OF lot
      ), released_lots AS (
        UPDATE user_energy_lots lot
        SET reserved_units = lot.reserved_units - allocation.units,
            available_units = lot.available_units + allocation.units,
            updated_at = ${at}
        FROM allocations allocation
        CROSS JOIN owner_left_operation operation
        WHERE lot.id = allocation.lot_id
          AND lot.reserved_units >= allocation.units
        RETURNING lot.id, lot.user_id, lot.bucket, allocation.units, operation.id AS operation_id
      ), release_tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT operation_id, user_id, id, bucket, 'RELEASE', units, ${at}
        FROM released_lots
        ON CONFLICT DO NOTHING
        RETURNING id
      ), released_reservation AS (
        UPDATE user_energy_reservations reservation
        SET status = 'RELEASED', updated_at = ${at}
        FROM owner_left_operation
        WHERE reservation.id = (SELECT id FROM reservation)
          AND (SELECT COUNT(*) FROM released_lots) = (SELECT COUNT(*) FROM allocations)
        RETURNING reservation.id
      ), owner_left_cancel AS (
        UPDATE reminders reminder
        SET status = 'CANCELLED',
            cancelled_at = ${at},
            delivery_lease_expires_at = NULL,
            updated_at = ${at}
        FROM released_reservation
        WHERE reminder.id = ${claim.reminderId}
          AND reminder.status = 'SCHEDULED'
        RETURNING reminder.id
      ), owner_left_audit AS (
        INSERT INTO audit_logs (
          group_id, actor_line_user_id, action, target_type, target_id, after_value, created_at
        )
        SELECT
          ${claim.groupId}, NULL, 'REMINDER_CANCELLED_OWNER_LEFT', 'REMINDER',
          id::text, jsonb_build_object('energyReleased', true), ${at}
        FROM owner_left_cancel
        RETURNING id
      ), authorized AS (
        UPDATE reminders reminder
        SET status = 'DISPATCHING', updated_at = ${at}
        FROM locked
        WHERE reminder.id = locked.id
          AND locked.status = 'SCHEDULED'
          AND locked.group_status = 'ACTIVE'
          AND locked.owner_active = TRUE
          AND reminder.delivery_attempt_count = ${claim.attemptCount}
          AND reminder.delivery_retry_key = ${claim.retryKey}
          AND reminder.delivery_lease_expires_at > ${at}
          AND EXISTS (SELECT 1 FROM reservation WHERE status = 'RESERVED')
        RETURNING reminder.id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM authorized) THEN 'AUTHORIZED'
        WHEN EXISTS (SELECT 1 FROM owner_left_cancel) THEN 'OWNER_LEFT'
        WHEN EXISTS (SELECT 1 FROM locked WHERE status = 'CANCELLED') THEN 'CANCELLED'
        WHEN EXISTS (SELECT 1 FROM locked WHERE group_status <> 'ACTIVE') THEN 'INACTIVE'
        ELSE 'STALE'
      END AS status
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    if (
      status === 'AUTHORIZED' || status === 'OWNER_LEFT' || status === 'CANCELLED' ||
      status === 'INACTIVE' || status === 'STALE'
    ) return status;
    return 'STALE';
  }

  async releaseForRetry(claim: ReminderDispatchClaim, at: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE reminders
      SET status = 'SCHEDULED', delivery_lease_expires_at = ${at}, updated_at = ${at}
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
      WITH reminder_state AS MATERIALIZED (
        SELECT reminder.id, reminder.status, reminder.delivery_reference, ownership.user_id,
               ownership.energy_reservation_id
        FROM reminders reminder
        JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
        WHERE reminder.id = ${claim.reminderId}
          AND reminder.group_id = ${claim.groupId}
        FOR UPDATE OF reminder
      ), reservation AS MATERIALIZED (
        SELECT reservation.id, reservation.user_id, reservation.requested_units, reservation.status
        FROM user_energy_reservations reservation
        JOIN reminder_state reminder ON reminder.energy_reservation_id = reservation.id
        FOR UPDATE OF reservation
      ), existing_operation AS (
        SELECT id, requested_units
        FROM user_energy_operations
        WHERE user_id = (SELECT user_id FROM reminder_state)
          AND type = 'RESERVED_CONSUME'
          AND reference_type = 'REMINDER_DELIVERY'
          AND reference_id = ${deliveryReference}
        LIMIT 1
      ), consume_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT
          reservation.user_id,
          'RESERVED_CONSUME',
          reservation.requested_units,
          'REMINDER_DELIVERY',
          ${deliveryReference},
          jsonb_build_object('reminderId', ${claim.reminderId}, 'retryKey', ${claim.retryKey}),
          ${at}
        FROM reservation
        CROSS JOIN reminder_state reminder
        WHERE reminder.status = 'DISPATCHING'
          AND reservation.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        ON CONFLICT DO NOTHING
        RETURNING id, user_id
      ), allocations AS MATERIALIZED (
        SELECT allocation.lot_id, allocation.units, lot.bucket
        FROM user_energy_reservation_allocations allocation
        JOIN reservation ON reservation.id = allocation.reservation_id
        JOIN user_energy_lots lot ON lot.id = allocation.lot_id
        FOR UPDATE OF lot
      ), updated_lots AS (
        UPDATE user_energy_lots lot
        SET reserved_units = lot.reserved_units - allocation.units,
            updated_at = ${at}
        FROM allocations allocation
        CROSS JOIN consume_operation operation
        WHERE lot.id = allocation.lot_id
          AND lot.reserved_units >= allocation.units
        RETURNING lot.id, lot.user_id, lot.bucket, allocation.units, operation.id AS operation_id
      ), tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT operation_id, user_id, id, bucket, 'RESERVED_CONSUME', units, ${at}
        FROM updated_lots
        ON CONFLICT DO NOTHING
        RETURNING id
      ), reservation_update AS (
        UPDATE user_energy_reservations reservation
        SET status = 'CONSUMED', updated_at = ${at}
        FROM consume_operation
        WHERE reservation.id = (SELECT id FROM reservation)
          AND (SELECT COUNT(*) FROM updated_lots) = (SELECT COUNT(*) FROM allocations)
        RETURNING reservation.id
      ), reminder_update AS (
        UPDATE reminders reminder
        SET status = 'DELIVERED',
            delivery_reference = ${deliveryReference},
            delivered_at = ${at},
            delivery_lease_expires_at = NULL,
            updated_at = ${at}
        FROM reservation_update
        WHERE reminder.id = ${claim.reminderId}
          AND reminder.status = 'DISPATCHING'
          AND reminder.delivery_attempt_count = ${claim.attemptCount}
          AND reminder.delivery_retry_key = ${claim.retryKey}
        RETURNING reminder.id
      ), audit AS (
        INSERT INTO audit_logs (
          group_id, actor_line_user_id, action, target_type, target_id, after_value, created_at
        )
        SELECT ${claim.groupId}, NULL, 'REMINDER_DELIVERED', 'REMINDER', id::text,
               jsonb_build_object('deliveryReference', ${deliveryReference}), ${at}
        FROM reminder_update
        RETURNING id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM reminder_state) THEN 'NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM reminder_state
          WHERE status = 'DELIVERED' AND delivery_reference = ${deliveryReference}
        ) THEN 'ALREADY_DELIVERED'
        WHEN EXISTS (SELECT 1 FROM reminder_state WHERE status = 'CANCELLED') THEN 'ALREADY_CANCELLED'
        WHEN EXISTS (SELECT 1 FROM reminder_update) THEN 'DELIVERED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      (SELECT id::text FROM reminder_state) AS reminder_id
    `);
    const row = result.rows[0] as MutationRow | undefined;
    if (!row) throw new Error('User Reminder delivery settlement returned no result');
    return {
      status: row.status,
      reminderId: row.reminder_id === null ? null : Number(row.reminder_id),
    };
  }
}
