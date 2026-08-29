import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  UserReminderCancelStatus,
  UserReminderCreateStatus,
  UserReminderMutationResult,
  UserReminderRepository,
} from './user-service';

function mutation<TStatus extends string>(row: Record<string, unknown> | undefined): UserReminderMutationResult<TStatus> {
  if (!row) throw new Error('User Reminder mutation returned no result');
  return {
    status: String(row.status) as TStatus,
    reminderId: row.reminder_id == null ? null : Number(row.reminder_id),
  };
}

export class DrizzleUserReminderRepository implements UserReminderRepository {
  constructor(private readonly db: Database) {}

  async create(
    input: Parameters<UserReminderRepository['create']>[0],
  ): Promise<UserReminderMutationResult<UserReminderCreateStatus>> {
    const result = await this.db.execute(sql`
      WITH owner AS MATERIALIZED (
        SELECT id, line_user_id
        FROM line_users
        WHERE line_user_id = ${input.ownerLineUserId}
        LIMIT 1
      ), group_state AS MATERIALIZED (
        SELECT id, status
        FROM line_groups
        WHERE id = ${input.groupId}
        LIMIT 1
      ), membership AS MATERIALIZED (
        SELECT 1
        FROM group_members
        WHERE group_id = ${input.groupId}
          AND line_user_id = ${input.ownerLineUserId}
          AND is_active = TRUE
        LIMIT 1
      ), existing_reminder AS MATERIALIZED (
        SELECT
          reminder.id,
          reminder.request_key,
          reminder.message,
          reminder.scheduled_for,
          reminder.status,
          ownership.user_id,
          reservation.requested_units,
          reservation.valid_through
        FROM reminders reminder
        LEFT JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
        LEFT JOIN user_energy_reservations reservation ON reservation.id = ownership.energy_reservation_id
        WHERE reminder.group_id = ${input.groupId}
          AND reminder.request_key = ${input.requestKey}
        LIMIT 1
      ), locked_lots AS MATERIALIZED (
        SELECT lot.id, lot.user_id, lot.bucket, lot.available_units, lot.expires_at
        FROM user_energy_lots lot
        JOIN owner ON owner.id = lot.user_id
        WHERE lot.available_units > 0
          AND (lot.expires_at IS NULL OR lot.expires_at > ${input.at})
          AND (
            (lot.bucket = 'SUBSCRIPTION' AND lot.expires_at > ${input.scheduledFor})
            OR (lot.bucket = 'PAID' AND lot.expires_at IS NULL)
          )
        ORDER BY
          CASE WHEN lot.bucket = 'SUBSCRIPTION' THEN 0 ELSE 1 END,
          lot.expires_at ASC NULLS LAST,
          lot.id
        FOR UPDATE OF lot
      ), ordered AS (
        SELECT
          lot.*,
          COALESCE(SUM(lot.available_units) OVER (
            ORDER BY CASE WHEN lot.bucket = 'SUBSCRIPTION' THEN 0 ELSE 1 END,
                     lot.expires_at ASC NULLS LAST,
                     lot.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0)::bigint AS before_units
        FROM locked_lots lot
      ), allocation AS (
        SELECT
          id,
          user_id,
          bucket,
          LEAST(
            available_units,
            GREATEST(${input.reservationUnits.toString()}::bigint - before_units, 0)
          )::bigint AS units
        FROM ordered
      ), sufficient AS (
        SELECT COALESCE(SUM(units), 0)::bigint >= ${input.reservationUnits.toString()}::bigint AS ok
        FROM allocation
      ), reserve_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT
          owner.id,
          'RESERVE',
          ${input.reservationUnits.toString()}::bigint,
          'REMINDER',
          ${input.requestKey},
          jsonb_build_object('groupId', ${input.groupId}, 'scheduledFor', ${input.scheduledFor.toISOString()}),
          ${input.at}
        FROM owner
        WHERE NOT EXISTS (SELECT 1 FROM existing_reminder)
          AND EXISTS (SELECT 1 FROM group_state WHERE status = 'ACTIVE')
          AND EXISTS (SELECT 1 FROM membership)
          AND (SELECT ok FROM sufficient)
        ON CONFLICT DO NOTHING
        RETURNING id, user_id
      ), reservation AS (
        INSERT INTO user_energy_reservations (
          user_id, reserve_operation_id, reference_type, reference_id,
          requested_units, status, valid_through, created_at, updated_at
        )
        SELECT
          operation.user_id,
          operation.id,
          'REMINDER',
          ${input.requestKey},
          ${input.reservationUnits.toString()}::bigint,
          'RESERVED',
          ${input.scheduledFor},
          ${input.at},
          ${input.at}
        FROM reserve_operation operation
        RETURNING id, user_id, reserve_operation_id
      ), updated_lots AS (
        UPDATE user_energy_lots lot
        SET available_units = lot.available_units - allocation.units,
            reserved_units = lot.reserved_units + allocation.units,
            updated_at = ${input.at}
        FROM allocation
        JOIN reserve_operation operation ON operation.user_id = allocation.user_id
        WHERE lot.id = allocation.id
          AND allocation.units > 0
        RETURNING lot.id, lot.user_id, lot.bucket, allocation.units
      ), energy_tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT
          operation.id,
          updated.user_id,
          updated.id,
          updated.bucket,
          'RESERVE',
          updated.units,
          ${input.at}
        FROM updated_lots updated
        JOIN reserve_operation operation ON operation.user_id = updated.user_id
        ON CONFLICT DO NOTHING
        RETURNING id
      ), reservation_allocation AS (
        INSERT INTO user_energy_reservation_allocations (reservation_id, lot_id, units, created_at)
        SELECT reservation.id, updated.id, updated.units, ${input.at}
        FROM reservation
        CROSS JOIN updated_lots updated
        ON CONFLICT DO NOTHING
        RETURNING id
      ), new_reminder AS (
        INSERT INTO reminders (
          group_id, request_key, message, scheduled_for, status,
          reserved_cost_twd, reserve_operation_id, created_by_line_user_id,
          created_at, updated_at
        )
        SELECT
          ${input.groupId},
          ${input.requestKey},
          ${input.message},
          ${input.scheduledFor},
          'SCHEDULED',
          0,
          NULL,
          ${input.ownerLineUserId},
          ${input.at},
          ${input.at}
        FROM reservation
        RETURNING id
      ), ownership AS (
        INSERT INTO user_reminder_ownership (
          reminder_id, user_id, group_id, energy_reservation_id, created_at
        )
        SELECT reminder.id, reservation.user_id, ${input.groupId}, reservation.id, ${input.at}
        FROM new_reminder reminder
        CROSS JOIN reservation
        RETURNING reminder_id, user_id
      ), audit AS (
        INSERT INTO audit_logs (
          group_id, actor_line_user_id, action, target_type, target_id, after_value, created_at
        )
        SELECT
          ${input.groupId},
          ${input.ownerLineUserId},
          'REMINDER_CREATED',
          'REMINDER',
          ownership.reminder_id::text,
          jsonb_build_object(
            'ownerUserId', ownership.user_id,
            'reservationUnits', ${input.reservationUnits.toString()},
            'scheduledFor', ${input.scheduledFor.toISOString()}
          ),
          ${input.at}
        FROM ownership
        RETURNING id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM owner) THEN 'OWNER_NOT_FOUND'
        WHEN NOT EXISTS (SELECT 1 FROM group_state) THEN 'GROUP_NOT_FOUND'
        WHEN EXISTS (SELECT 1 FROM group_state WHERE status <> 'ACTIVE') THEN 'GROUP_INACTIVE'
        WHEN NOT EXISTS (SELECT 1 FROM membership) THEN 'OWNER_NOT_GROUP_MEMBER'
        WHEN EXISTS (
          SELECT 1 FROM existing_reminder existing
          JOIN owner ON TRUE
          WHERE existing.message <> ${input.message}
             OR existing.scheduled_for IS DISTINCT FROM ${input.scheduledFor}
             OR existing.user_id IS DISTINCT FROM owner.id
             OR existing.requested_units IS DISTINCT FROM ${input.reservationUnits.toString()}::bigint
             OR existing.valid_through IS DISTINCT FROM ${input.scheduledFor}
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing_reminder) THEN 'ALREADY_CREATED'
        WHEN NOT (SELECT ok FROM sufficient) THEN 'INSUFFICIENT_PROACTIVE_ENERGY'
        WHEN EXISTS (SELECT 1 FROM ownership) THEN 'CREATED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      COALESCE(
        (SELECT id::text FROM existing_reminder),
        (SELECT reminder_id::text FROM ownership)
      ) AS reminder_id
    `);
    return mutation<UserReminderCreateStatus>(result.rows[0] as Record<string, unknown> | undefined);
  }

  async cancel(
    input: Parameters<UserReminderRepository['cancel']>[0],
  ): Promise<UserReminderMutationResult<UserReminderCancelStatus>> {
    const result = await this.db.execute(sql`
      WITH owner AS MATERIALIZED (
        SELECT id FROM line_users WHERE line_user_id = ${input.ownerLineUserId} LIMIT 1
      ), reminder_state AS MATERIALIZED (
        SELECT reminder.id, reminder.status, ownership.user_id, ownership.energy_reservation_id
        FROM reminders reminder
        JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
        WHERE reminder.id = ${input.reminderId}
          AND reminder.group_id = ${input.groupId}
        FOR UPDATE OF reminder
      ), reservation AS MATERIALIZED (
        SELECT reservation.id, reservation.user_id, reservation.requested_units, reservation.status
        FROM user_energy_reservations reservation
        JOIN reminder_state reminder ON reminder.energy_reservation_id = reservation.id
        FOR UPDATE OF reservation
      ), existing_operation AS (
        SELECT id, requested_units
        FROM user_energy_operations
        WHERE user_id = (SELECT id FROM owner)
          AND type = 'RELEASE'
          AND reference_type = 'REMINDER_CANCEL'
          AND reference_id = ${input.mutationKey}
        LIMIT 1
      ), release_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT
          reservation.user_id,
          'RELEASE',
          reservation.requested_units,
          'REMINDER_CANCEL',
          ${input.mutationKey},
          jsonb_build_object('reminderId', ${input.reminderId}),
          ${input.at}
        FROM reservation
        JOIN owner ON owner.id = reservation.user_id
        JOIN reminder_state reminder ON reminder.user_id = owner.id
        WHERE reminder.status = 'SCHEDULED'
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
            available_units = lot.available_units + allocation.units,
            updated_at = ${input.at}
        FROM allocations allocation
        JOIN release_operation operation ON TRUE
        WHERE lot.id = allocation.lot_id
          AND lot.reserved_units >= allocation.units
        RETURNING lot.id, lot.user_id, lot.bucket, allocation.units
      ), tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT operation.id, updated.user_id, updated.id, updated.bucket, 'RELEASE', updated.units, ${input.at}
        FROM updated_lots updated
        CROSS JOIN release_operation operation
        ON CONFLICT DO NOTHING
        RETURNING id
      ), reservation_update AS (
        UPDATE user_energy_reservations reservation
        SET status = 'RELEASED', updated_at = ${input.at}
        FROM release_operation
        WHERE reservation.id = (SELECT id FROM reservation)
          AND (SELECT COUNT(*) FROM updated_lots) = (SELECT COUNT(*) FROM allocations)
        RETURNING reservation.id
      ), reminder_update AS (
        UPDATE reminders reminder
        SET status = 'CANCELLED',
            cancelled_by_line_user_id = ${input.ownerLineUserId},
            cancelled_at = ${input.at},
            updated_at = ${input.at}
        FROM reservation_update
        WHERE reminder.id = ${input.reminderId}
          AND reminder.status = 'SCHEDULED'
        RETURNING reminder.id
      ), audit AS (
        INSERT INTO audit_logs (
          group_id, actor_line_user_id, action, target_type, target_id, created_at
        )
        SELECT ${input.groupId}, ${input.ownerLineUserId}, 'REMINDER_CANCELLED', 'REMINDER', id::text, ${input.at}
        FROM reminder_update
        RETURNING id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM reminder_state) THEN 'NOT_FOUND'
        WHEN NOT EXISTS (
          SELECT 1 FROM reminder_state reminder JOIN owner ON owner.id = reminder.user_id
        ) THEN 'NOT_OWNER'
        WHEN EXISTS (SELECT 1 FROM reminder_state WHERE status = 'CANCELLED') THEN 'ALREADY_CANCELLED'
        WHEN EXISTS (SELECT 1 FROM reminder_state WHERE status = 'DELIVERED') THEN 'ALREADY_DELIVERED'
        WHEN EXISTS (
          SELECT 1 FROM existing_operation
          WHERE requested_units <> (SELECT requested_units FROM reservation)
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM reminder_update) THEN 'CANCELLED'
        WHEN EXISTS (SELECT 1 FROM existing_operation) THEN 'ALREADY_CANCELLED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      (SELECT id::text FROM reminder_state) AS reminder_id
    `);
    return mutation<UserReminderCancelStatus>(result.rows[0] as Record<string, unknown> | undefined);
  }
}
