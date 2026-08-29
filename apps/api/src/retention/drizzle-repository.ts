import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  RetentionPurgeResult,
  RetentionRepository,
  RetentionSweepCommand,
} from './service';

type PurgeRow = {
  group_id: string;
  retained_anchor: boolean;
};

type CountRow = { blocked_count: string | number };

/**
 * Retention intentionally deletes recoverable/private product state while preserving
 * credit/usage/audit reconciliation rows. A minimal line_groups anchor is retained
 * only while non-zero PAID value still needs the stable LINE group identity.
 *
 * A GROUP_PRODUCT_DATA_PURGED audit row at/after the current inactive_at acts as the
 * durable purge marker. If the Group later rejoins and leaves again, the new inactive_at
 * is newer than the old marker, so the next retention cycle is eligible normally.
 */
export class DrizzleRetentionRepository implements RetentionRepository {
  constructor(private readonly db: Database) {}

  async countBlockedDue(command: RetentionSweepCommand): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*)::text AS blocked_count
      FROM line_groups AS group_state
      WHERE group_state.status = 'INACTIVE'
        AND group_state.inactive_at IS NOT NULL
        AND (
          (group_state.has_paid = FALSE AND group_state.inactive_at <= ${command.neverPaidBefore})
          OR
          (group_state.has_paid = TRUE AND group_state.inactive_at <= ${command.paidBefore})
        )
        AND NOT EXISTS (
          SELECT 1
          FROM audit_logs AS retention_audit
          WHERE retention_audit.group_id = group_state.id
            AND retention_audit.action = 'GROUP_PRODUCT_DATA_PURGED'
            AND retention_audit.created_at >= group_state.inactive_at
        )
        AND EXISTS (
          SELECT 1
          FROM reminders AS reminder
          LEFT JOIN credit_reservations AS reservation
            ON reservation.group_id = reminder.group_id
           AND reservation.reference_type = 'REMINDER'
           AND reservation.reference_id = reminder.request_key
          WHERE reminder.group_id = group_state.id
            AND (
              reminder.status IN ('SCHEDULED', 'DISPATCHING')
              OR reservation.status = 'RESERVED'
            )
        )
    `);
    const row = result.rows[0] as CountRow | undefined;
    return row ? Number(row.blocked_count) : 0;
  }

  async purgeNext(command: RetentionSweepCommand): Promise<RetentionPurgeResult | null> {
    const result = await this.db.execute(sql`
      WITH candidate AS MATERIALIZED (
        SELECT group_state.id, group_state.has_paid, group_state.inactive_at
        FROM line_groups AS group_state
        WHERE group_state.status = 'INACTIVE'
          AND group_state.inactive_at IS NOT NULL
          AND (
            (group_state.has_paid = FALSE AND group_state.inactive_at <= ${command.neverPaidBefore})
            OR
            (group_state.has_paid = TRUE AND group_state.inactive_at <= ${command.paidBefore})
          )
          AND NOT EXISTS (
            SELECT 1
            FROM audit_logs AS retention_audit
            WHERE retention_audit.group_id = group_state.id
              AND retention_audit.action = 'GROUP_PRODUCT_DATA_PURGED'
              AND retention_audit.created_at >= group_state.inactive_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM reminders AS reminder
            LEFT JOIN credit_reservations AS reservation
              ON reservation.group_id = reminder.group_id
             AND reservation.reference_type = 'REMINDER'
             AND reservation.reference_id = reminder.request_key
            WHERE reminder.group_id = group_state.id
              AND (
                reminder.status IN ('SCHEDULED', 'DISPATCHING')
                OR reservation.status = 'RESERVED'
              )
          )
        ORDER BY group_state.inactive_at, group_state.id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ),
      paid_anchor AS MATERIALIZED (
        SELECT EXISTS (
          SELECT 1
          FROM credit_accounts AS account
          JOIN candidate ON candidate.id = account.group_id
          WHERE account.bucket = 'PAID'
            AND (
              account.available_cost_twd > 0
              OR account.reserved_cost_twd > 0
            )
        ) AS retain
      ),
      request_ids AS MATERIALIZED (
        SELECT request.id
        FROM memory_candidate_requests AS request
        JOIN candidate ON candidate.id = request.group_id
      ),
      deleted_classifier_results AS (
        DELETE FROM memory_classifier_results
        WHERE request_id IN (SELECT id FROM request_ids)
        RETURNING request_id
      ),
      deleted_candidate_results AS (
        DELETE FROM memory_candidate_results
        WHERE request_id IN (SELECT id FROM request_ids)
        RETURNING request_id
      ),
      deleted_work_states AS (
        DELETE FROM memory_request_work_states
        WHERE request_id IN (SELECT id FROM request_ids)
        RETURNING request_id
      ),
      deleted_automatic_keys AS (
        DELETE FROM automatic_memory_request_keys
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING request_id
      ),
      deleted_requests AS (
        DELETE FROM memory_candidate_requests
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING id
      ),
      deleted_messages AS (
        DELETE FROM conversation_messages
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING id
      ),
      deleted_batches AS (
        DELETE FROM conversation_extraction_batches
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING id
      ),
      deleted_memories AS (
        DELETE FROM memories
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING id
      ),
      deleted_members AS (
        DELETE FROM group_members
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING id
      ),
      deleted_ad_policy AS (
        DELETE FROM rewarded_ad_policy_state
        WHERE group_id IN (SELECT id FROM candidate)
        RETURNING id
      ),
      deleted_terminal_reminders AS (
        DELETE FROM reminders
        WHERE group_id IN (SELECT id FROM candidate)
          AND status IN ('CANCELLED', 'DELIVERED')
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
          candidate.id,
          NULL,
          'GROUP_PRODUCT_DATA_PURGED',
          'LINE_GROUP',
          candidate.id::text,
          jsonb_build_object(
            'inactiveAt', candidate.inactive_at,
            'hasPaid', candidate.has_paid,
            'paidAnchorRetained', (SELECT retain FROM paid_anchor),
            'policy', CASE WHEN candidate.has_paid THEN 'PAID_1_YEAR' ELSE 'NEVER_PAID_30_DAYS' END
          ),
          ${command.at}
        FROM candidate
        RETURNING group_id
      ),
      retained_group AS (
        UPDATE line_groups AS group_state
        SET pending_message_count = 0,
            pending_char_count = 0,
            updated_at = ${command.at}
        FROM candidate
        WHERE group_state.id = candidate.id
          AND (SELECT retain FROM paid_anchor)
        RETURNING group_state.id
      ),
      deleted_group AS (
        DELETE FROM line_groups AS group_state
        USING candidate
        WHERE group_state.id = candidate.id
          AND NOT (SELECT retain FROM paid_anchor)
        RETURNING group_state.id
      )
      SELECT
        candidate.id::text AS group_id,
        (SELECT retain FROM paid_anchor) AS retained_anchor
      FROM candidate
    `);

    const row = result.rows[0] as PurgeRow | undefined;
    if (!row) return null;
    return {
      status: row.retained_anchor ? 'PURGED_ANCHOR_RETAINED' : 'PURGED_GROUP_REMOVED',
      groupId: Number(row.group_id),
    };
  }
}
