import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { formatTwdCostUnits } from '../credits/allocation';
import type {
  ReminderCancelCommand,
  ReminderCancelStatus,
  ReminderCreateCommand,
  ReminderCreateStatus,
  ReminderDeliveryCommand,
  ReminderDeliveryStatus,
  ReminderMutationResult,
  ReminderRepository,
} from './service';

type MutationRow<TStatus extends string> = {
  status: TStatus;
  reminder_id: string | null;
};

type ExistingReminderRow = {
  id: string;
  request_key: string;
  message: string;
  scheduled_for: Date | string;
  reserved_cost_twd: string;
  created_by_line_user_id: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'DELIVERED';
  delivery_reference: string | null;
};

const REMINDER_REFERENCE_TYPE = 'REMINDER';

function mutationFromRow<TStatus extends string>(
  row: MutationRow<TStatus> | undefined,
): ReminderMutationResult<TStatus> {
  if (!row) throw new Error('reminder mutation returned no result');
  return {
    status: row.status,
    reminderId: row.reminder_id === null ? null : Number(row.reminder_id),
  };
}

function sameInstant(value: Date | string, expected: Date): boolean {
  return new Date(value).getTime() === expected.getTime();
}

/**
 * Reminder state and PAID credit settlement intentionally share the same SQL statement.
 * This keeps the reminder row, credit operation/reservation, account mutation and audit log
 * in one PostgreSQL transaction boundary instead of relying on a crash-prone service saga.
 */
export class DrizzleReminderRepository implements ReminderRepository {
  constructor(private readonly db: Database) {}

  async create(
    command: ReminderCreateCommand,
  ): Promise<ReminderMutationResult<ReminderCreateStatus>> {
    const amount = formatTwdCostUnits(command.reservedCostUnits);
    const result = await this.db.execute(sql`
      WITH existing_reminder AS MATERIALIZED (
        SELECT
          id,
          request_key,
          message,
          scheduled_for,
          reserved_cost_twd,
          created_by_line_user_id,
          status
        FROM reminders
        WHERE group_id = ${command.groupId}
          AND request_key = ${command.requestKey}
        LIMIT 1
      ),
      group_state AS MATERIALIZED (
        SELECT status
        FROM line_groups
        WHERE id = ${command.groupId}
        LIMIT 1
      ),
      locked_paid AS MATERIALIZED (
        SELECT available_cost_twd
        FROM credit_accounts
        WHERE group_id = ${command.groupId}
          AND bucket = 'PAID'
          AND (expires_at IS NULL OR expires_at > ${command.at})
        FOR UPDATE
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id,
          type,
          scope_bucket,
          requested_amount_cost_twd,
          reference_type,
          reference_id,
          created_at
        )
        SELECT
          ${command.groupId},
          'RESERVE',
          'PAID',
          CAST(${amount} AS numeric),
          ${REMINDER_REFERENCE_TYPE},
          ${command.requestKey},
          ${command.at}
        WHERE NOT EXISTS (SELECT 1 FROM existing_reminder)
          AND EXISTS (SELECT 1 FROM group_state WHERE status = 'ACTIVE')
          AND COALESCE((SELECT available_cost_twd FROM locked_paid LIMIT 1), 0)
              >= CAST(${amount} AS numeric)
        ON CONFLICT DO NOTHING
        RETURNING id, requested_amount_cost_twd
      ),
      reservation AS (
        INSERT INTO credit_reservations (
          group_id,
          reserve_operation_id,
          reference_type,
          reference_id,
          amount_cost_twd,
          status,
          created_at,
          updated_at
        )
        SELECT
          ${command.groupId},
          operation.id,
          ${REMINDER_REFERENCE_TYPE},
          ${command.requestKey},
          operation.requested_amount_cost_twd,
          'RESERVED',
          ${command.at},
          ${command.at}
        FROM new_operation AS operation
        ON CONFLICT DO NOTHING
        RETURNING reserve_operation_id, amount_cost_twd
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id,
          group_id,
          bucket,
          type,
          amount_cost_twd,
          created_at
        )
        SELECT
          reserve_operation_id,
          ${command.groupId},
          'PAID',
          'RESERVE',
          amount_cost_twd,
          ${command.at}
        FROM reservation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET available_cost_twd = account.available_cost_twd - ledger.amount_cost_twd,
            reserved_cost_twd = account.reserved_cost_twd + ledger.amount_cost_twd,
            updated_at = ${command.at}
        FROM ledger
        WHERE account.group_id = ${command.groupId}
          AND account.bucket = 'PAID'
          AND account.available_cost_twd >= ledger.amount_cost_twd
        RETURNING ledger.operation_id
      ),
      new_reminder AS (
        INSERT INTO reminders (
          group_id,
          request_key,
          message,
          scheduled_for,
          status,
          reserved_cost_twd,
          reserve_operation_id,
          created_by_line_user_id,
          created_at,
          updated_at
        )
        SELECT
          ${command.groupId},
          ${command.requestKey},
          ${command.message},
          ${command.scheduledFor},
          'SCHEDULED',
          CAST(${amount} AS numeric),
          operation.id,
          ${command.actorLineUserId},
          ${command.at},
          ${command.at}
        FROM new_operation AS operation
        WHERE EXISTS (
          SELECT 1 FROM account_mutation WHERE operation_id = operation.id
        )
        ON CONFLICT DO NOTHING
        RETURNING id
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
          ${command.actorLineUserId},
          'REMINDER_CREATED',
          'REMINDER',
          reminder.id::text,
          jsonb_build_object(
            'requestKey', ${command.requestKey},
            'scheduledFor', ${command.scheduledFor},
            'reservedCostTwd', CAST(${amount} AS numeric)
          ),
          ${command.at}
        FROM new_reminder AS reminder
        RETURNING id
      )
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM existing_reminder
            WHERE message <> ${command.message}
               OR scheduled_for <> ${command.scheduledFor}
               OR reserved_cost_twd <> CAST(${amount} AS numeric)
               OR created_by_line_user_id <> ${command.actorLineUserId}
          ) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing_reminder) THEN 'ALREADY_CREATED'
          WHEN NOT EXISTS (SELECT 1 FROM group_state) THEN 'GROUP_NOT_FOUND'
          WHEN NOT EXISTS (SELECT 1 FROM group_state WHERE status = 'ACTIVE') THEN 'GROUP_INACTIVE'
          WHEN COALESCE((SELECT available_cost_twd FROM locked_paid LIMIT 1), 0)
              < CAST(${amount} AS numeric) THEN 'INSUFFICIENT_PAID'
          WHEN EXISTS (SELECT 1 FROM new_reminder) THEN 'CREATED'
          ELSE 'ALREADY_CREATED'
        END AS status,
        COALESCE(
          (SELECT id::text FROM new_reminder LIMIT 1),
          (SELECT id::text FROM existing_reminder LIMIT 1)
        ) AS reminder_id
    `);

    const mutation = mutationFromRow(
      result.rows[0] as MutationRow<ReminderCreateStatus> | undefined,
    );
    if (mutation.reminderId !== null || mutation.status !== 'ALREADY_CREATED') {
      return mutation;
    }
    return this.resolveConcurrentCreate(command, amount);
  }

  private async resolveConcurrentCreate(
    command: ReminderCreateCommand,
    amount: string,
  ): Promise<ReminderMutationResult<ReminderCreateStatus>> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        request_key,
        message,
        scheduled_for,
        reserved_cost_twd::text AS reserved_cost_twd,
        created_by_line_user_id,
        status,
        delivery_reference
      FROM reminders
      WHERE group_id = ${command.groupId}
        AND request_key = ${command.requestKey}
      LIMIT 1
    `);
    const existing = result.rows[0] as ExistingReminderRow | undefined;
    if (!existing) return { status: 'REFERENCE_CONFLICT', reminderId: null };

    const conflict =
      existing.message !== command.message ||
      !sameInstant(existing.scheduled_for, command.scheduledFor) ||
      existing.reserved_cost_twd !== amount ||
      existing.created_by_line_user_id !== command.actorLineUserId;
    return {
      status: conflict ? 'REFERENCE_CONFLICT' : 'ALREADY_CREATED',
      reminderId: Number(existing.id),
    };
  }

  async cancel(
    command: ReminderCancelCommand,
  ): Promise<ReminderMutationResult<ReminderCancelStatus>> {
    const result = await this.db.execute(sql`
      WITH locked_reminder AS MATERIALIZED (
        SELECT id, request_key, status, scheduled_for
        FROM reminders
        WHERE id = ${command.reminderId}
          AND group_id = ${command.groupId}
        FOR UPDATE
      ),
      existing_operation AS MATERIALIZED (
        SELECT operation.id
        FROM credit_operations AS operation
        JOIN locked_reminder AS reminder
          ON operation.reference_id = reminder.request_key
        WHERE operation.group_id = ${command.groupId}
          AND operation.type = 'RELEASE'
          AND operation.reference_type = ${REMINDER_REFERENCE_TYPE}
        LIMIT 1
      ),
      locked_reservation AS MATERIALIZED (
        SELECT reservation.id, reservation.amount_cost_twd, reservation.status
        FROM credit_reservations AS reservation
        JOIN locked_reminder AS reminder
          ON reservation.reference_id = reminder.request_key
        WHERE reservation.group_id = ${command.groupId}
          AND reservation.reference_type = ${REMINDER_REFERENCE_TYPE}
        FOR UPDATE
      ),
      transitioned AS (
        UPDATE credit_reservations AS reservation
        SET status = 'RELEASED', updated_at = ${command.at}
        FROM locked_reservation, locked_reminder
        WHERE reservation.id = locked_reservation.id
          AND locked_reminder.status = 'SCHEDULED'
          AND locked_reservation.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        RETURNING reservation.amount_cost_twd
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id,
          type,
          scope_bucket,
          requested_amount_cost_twd,
          reference_type,
          reference_id,
          created_at
        )
        SELECT
          ${command.groupId},
          'RELEASE',
          'PAID',
          transitioned.amount_cost_twd,
          ${REMINDER_REFERENCE_TYPE},
          reminder.request_key,
          ${command.at}
        FROM transitioned
        CROSS JOIN locked_reminder AS reminder
        ON CONFLICT DO NOTHING
        RETURNING id, requested_amount_cost_twd
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id,
          group_id,
          bucket,
          type,
          amount_cost_twd,
          created_at
        )
        SELECT
          id,
          ${command.groupId},
          'PAID',
          'RELEASE',
          requested_amount_cost_twd,
          ${command.at}
        FROM new_operation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET available_cost_twd = account.available_cost_twd + ledger.amount_cost_twd,
            reserved_cost_twd = account.reserved_cost_twd - ledger.amount_cost_twd,
            updated_at = ${command.at}
        FROM ledger
        WHERE account.group_id = ${command.groupId}
          AND account.bucket = 'PAID'
          AND account.reserved_cost_twd >= ledger.amount_cost_twd
        RETURNING ledger.operation_id
      ),
      reminder_mutation AS (
        UPDATE reminders AS reminder
        SET status = 'CANCELLED',
            cancelled_by_line_user_id = ${command.actorLineUserId},
            cancelled_at = ${command.at},
            updated_at = ${command.at}
        FROM account_mutation
        WHERE reminder.id = ${command.reminderId}
          AND reminder.group_id = ${command.groupId}
          AND reminder.status = 'SCHEDULED'
        RETURNING reminder.id, reminder.scheduled_for
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
          ${command.actorLineUserId},
          'REMINDER_CANCELLED',
          'REMINDER',
          reminder.id::text,
          jsonb_build_object('scheduledFor', reminder.scheduled_for),
          ${command.at}
        FROM reminder_mutation AS reminder
        RETURNING id
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM locked_reminder) THEN 'NOT_FOUND'
          WHEN EXISTS (SELECT 1 FROM locked_reminder WHERE status = 'CANCELLED') THEN 'ALREADY_CANCELLED'
          WHEN EXISTS (SELECT 1 FROM locked_reminder WHERE status = 'DELIVERED') THEN 'ALREADY_DELIVERED'
          WHEN EXISTS (SELECT 1 FROM reminder_mutation) THEN 'CANCELLED'
          ELSE 'REFERENCE_CONFLICT'
        END AS status,
        (SELECT id::text FROM locked_reminder LIMIT 1) AS reminder_id
    `);

    return mutationFromRow(
      result.rows[0] as MutationRow<ReminderCancelStatus> | undefined,
    );
  }

  async settleSuccessfulDelivery(
    command: ReminderDeliveryCommand,
  ): Promise<ReminderMutationResult<ReminderDeliveryStatus>> {
    const result = await this.db.execute(sql`
      WITH locked_reminder AS MATERIALIZED (
        SELECT id, request_key, status, scheduled_for, delivery_reference
        FROM reminders
        WHERE id = ${command.reminderId}
          AND group_id = ${command.groupId}
        FOR UPDATE
      ),
      existing_operation AS MATERIALIZED (
        SELECT operation.id
        FROM credit_operations AS operation
        JOIN locked_reminder AS reminder
          ON operation.reference_id = reminder.request_key
        WHERE operation.group_id = ${command.groupId}
          AND operation.type = 'CONSUME'
          AND operation.reference_type = ${REMINDER_REFERENCE_TYPE}
        LIMIT 1
      ),
      locked_reservation AS MATERIALIZED (
        SELECT reservation.id, reservation.amount_cost_twd, reservation.status
        FROM credit_reservations AS reservation
        JOIN locked_reminder AS reminder
          ON reservation.reference_id = reminder.request_key
        WHERE reservation.group_id = ${command.groupId}
          AND reservation.reference_type = ${REMINDER_REFERENCE_TYPE}
        FOR UPDATE
      ),
      transitioned AS (
        UPDATE credit_reservations AS reservation
        SET status = 'CONSUMED', updated_at = ${command.at}
        FROM locked_reservation, locked_reminder
        WHERE reservation.id = locked_reservation.id
          AND locked_reminder.status = 'SCHEDULED'
          AND locked_reservation.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        RETURNING reservation.amount_cost_twd
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id,
          type,
          scope_bucket,
          requested_amount_cost_twd,
          reference_type,
          reference_id,
          created_at
        )
        SELECT
          ${command.groupId},
          'CONSUME',
          'PAID',
          transitioned.amount_cost_twd,
          ${REMINDER_REFERENCE_TYPE},
          reminder.request_key,
          ${command.at}
        FROM transitioned
        CROSS JOIN locked_reminder AS reminder
        ON CONFLICT DO NOTHING
        RETURNING id, requested_amount_cost_twd
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id,
          group_id,
          bucket,
          type,
          amount_cost_twd,
          created_at
        )
        SELECT
          id,
          ${command.groupId},
          'PAID',
          'CONSUME',
          requested_amount_cost_twd,
          ${command.at}
        FROM new_operation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET reserved_cost_twd = account.reserved_cost_twd - ledger.amount_cost_twd,
            updated_at = ${command.at}
        FROM ledger
        WHERE account.group_id = ${command.groupId}
          AND account.bucket = 'PAID'
          AND account.reserved_cost_twd >= ledger.amount_cost_twd
        RETURNING ledger.operation_id
      ),
      reminder_mutation AS (
        UPDATE reminders AS reminder
        SET status = 'DELIVERED',
            delivery_reference = ${command.deliveryReference},
            delivered_at = ${command.at},
            updated_at = ${command.at}
        FROM account_mutation
        WHERE reminder.id = ${command.reminderId}
          AND reminder.group_id = ${command.groupId}
          AND reminder.status = 'SCHEDULED'
        RETURNING reminder.id, reminder.scheduled_for
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
          'REMINDER_DELIVERED',
          'REMINDER',
          reminder.id::text,
          jsonb_build_object(
            'scheduledFor', reminder.scheduled_for,
            'deliveryReference', ${command.deliveryReference}
          ),
          ${command.at}
        FROM reminder_mutation AS reminder
        RETURNING id
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM locked_reminder) THEN 'NOT_FOUND'
          WHEN EXISTS (SELECT 1 FROM locked_reminder WHERE status = 'CANCELLED') THEN 'ALREADY_CANCELLED'
          WHEN EXISTS (
            SELECT 1 FROM locked_reminder
            WHERE status = 'DELIVERED'
              AND delivery_reference = ${command.deliveryReference}
          ) THEN 'ALREADY_DELIVERED'
          WHEN EXISTS (SELECT 1 FROM locked_reminder WHERE status = 'DELIVERED') THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM reminder_mutation) THEN 'DELIVERED'
          ELSE 'REFERENCE_CONFLICT'
        END AS status,
        (SELECT id::text FROM locked_reminder LIMIT 1) AS reminder_id
    `);

    return mutationFromRow(
      result.rows[0] as MutationRow<ReminderDeliveryStatus> | undefined,
    );
  }
}
