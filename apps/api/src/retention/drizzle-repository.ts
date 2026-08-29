import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  RetentionPurgeResult,
  RetentionRepository,
  RetentionSweepCommand,
} from './service';

type PurgeRow = { group_id: string; retained_anchor: boolean };
type CountRow = { blocked_count: string | number };

/**
 * Group retention deletes recoverable conversation/memory product data only.
 * User-owned financial history remains reconcilable. Active Reminder/Proactive work
 * blocks purge; terminal message content is redacted/deleted where safe.
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
          OR (group_state.has_paid = TRUE AND group_state.inactive_at <= ${command.paidBefore})
        )
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs retention_audit
          WHERE retention_audit.group_id = group_state.id
            AND retention_audit.action = 'GROUP_PRODUCT_DATA_PURGED'
            AND retention_audit.created_at >= group_state.inactive_at
        )
        AND (
          EXISTS (
            SELECT 1
            FROM reminders reminder
            LEFT JOIN credit_reservations legacy_reservation
              ON legacy_reservation.group_id = reminder.group_id
             AND legacy_reservation.reference_type = 'REMINDER'
             AND legacy_reservation.reference_id = reminder.request_key
            LEFT JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
            LEFT JOIN user_energy_reservations energy_reservation
              ON energy_reservation.id = ownership.energy_reservation_id
            WHERE reminder.group_id = group_state.id
              AND (
                reminder.status IN ('SCHEDULED', 'DISPATCHING')
                OR legacy_reservation.status = 'RESERVED'
                OR energy_reservation.status = 'RESERVED'
              )
          )
          OR EXISTS (
            SELECT 1 FROM proactive_pushes proactive
            WHERE proactive.group_id = group_state.id
              AND proactive.status IN ('SCHEDULED', 'DISPATCHING')
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
        FROM line_groups group_state
        WHERE group_state.status = 'INACTIVE'
          AND group_state.inactive_at IS NOT NULL
          AND (
            (group_state.has_paid = FALSE AND group_state.inactive_at <= ${command.neverPaidBefore})
            OR (group_state.has_paid = TRUE AND group_state.inactive_at <= ${command.paidBefore})
          )
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs retention_audit
            WHERE retention_audit.group_id = group_state.id
              AND retention_audit.action = 'GROUP_PRODUCT_DATA_PURGED'
              AND retention_audit.created_at >= group_state.inactive_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM reminders reminder
            LEFT JOIN credit_reservations legacy_reservation
              ON legacy_reservation.group_id = reminder.group_id
             AND legacy_reservation.reference_type = 'REMINDER'
             AND legacy_reservation.reference_id = reminder.request_key
            LEFT JOIN user_reminder_ownership ownership ON ownership.reminder_id = reminder.id
            LEFT JOIN user_energy_reservations energy_reservation
              ON energy_reservation.id = ownership.energy_reservation_id
            WHERE reminder.group_id = group_state.id
              AND (
                reminder.status IN ('SCHEDULED', 'DISPATCHING')
                OR legacy_reservation.status = 'RESERVED'
                OR energy_reservation.status = 'RESERVED'
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM proactive_pushes proactive
            WHERE proactive.group_id = group_state.id
              AND proactive.status IN ('SCHEDULED', 'DISPATCHING')
          )
        ORDER BY group_state.inactive_at, group_state.id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ),
      reconciliation_anchor AS MATERIALIZED (
        SELECT (
          EXISTS (
            SELECT 1 FROM credit_accounts account
            JOIN candidate ON candidate.id = account.group_id
            WHERE account.bucket = 'PAID'
              AND (account.available_cost_twd > 0 OR account.reserved_cost_twd > 0)
          )
          OR EXISTS (
            SELECT 1 FROM user_reminder_ownership ownership
            JOIN candidate ON candidate.id = ownership.group_id
          )
          OR EXISTS (
            SELECT 1 FROM ai_energy_usage_events usage
            JOIN candidate ON candidate.id = usage.group_id
          )
          OR EXISTS (
            SELECT 1 FROM ai_user_energy_allocations allocation
            JOIN candidate ON candidate.id = allocation.group_id
          )
          OR EXISTS (
            SELECT 1 FROM explicit_ai_chat_requests chat
            JOIN candidate ON candidate.id = chat.group_id
            WHERE chat.energy_units IS NOT NULL
          )
        ) AS retain
      ),
      request_ids AS MATERIALIZED (
        SELECT request.id
        FROM memory_candidate_requests request
        JOIN candidate ON candidate.id = request.group_id
      ),
      financial_request_ids AS MATERIALIZED (
        SELECT request.id
        FROM memory_candidate_requests request
        JOIN candidate ON candidate.id = request.group_id
        WHERE EXISTS (
          SELECT 1 FROM ai_energy_usage_events usage WHERE usage.request_id = request.id
        ) OR EXISTS (
          SELECT 1 FROM ai_user_energy_allocations allocation WHERE allocation.request_id = request.id
        )
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
      deleted_nonfinancial_eligible_subjects AS (
        DELETE FROM automatic_memory_eligible_subjects
        WHERE request_id IN (SELECT id FROM request_ids)
          AND request_id NOT IN (SELECT id FROM financial_request_ids)
        RETURNING request_id
      ),
      redacted_financial_requests AS (
        UPDATE memory_candidate_requests request
        SET request_line_message_id = NULL,
            actor_line_user_id = NULL,
            source_line_message_id = NULL,
            source_conversation_message_id = NULL,
            instruction = NULL,
            extraction_batch_id = NULL,
            updated_at = ${command.at}
        WHERE request.id IN (SELECT id FROM financial_request_ids)
        RETURNING request.id
      ),
      deleted_requests AS (
        DELETE FROM memory_candidate_requests
        WHERE group_id IN (SELECT id FROM candidate)
          AND id NOT IN (SELECT id FROM financial_request_ids)
        RETURNING id
      ),
      redacted_paid_chat AS (
        UPDATE explicit_ai_chat_requests chat
        SET prompt = '[PURGED]',
            response_text = CASE WHEN chat.energy_units IS NULL THEN NULL ELSE '[PURGED]' END,
            updated_at = ${command.at}
        WHERE chat.group_id IN (SELECT id FROM candidate)
          AND chat.energy_units IS NOT NULL
        RETURNING chat.id
      ),
      deleted_unbilled_chat AS (
        DELETE FROM explicit_ai_chat_requests chat
        WHERE chat.group_id IN (SELECT id FROM candidate)
          AND chat.energy_units IS NULL
        RETURNING chat.id
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
      redacted_user_reminders AS (
        UPDATE reminders reminder
        SET message = '[PURGED]', updated_at = ${command.at}
        WHERE reminder.group_id IN (SELECT id FROM candidate)
          AND reminder.status IN ('CANCELLED', 'DELIVERED')
          AND EXISTS (
            SELECT 1 FROM user_reminder_ownership ownership
            WHERE ownership.reminder_id = reminder.id
          )
        RETURNING reminder.id
      ),
      deleted_legacy_terminal_reminders AS (
        DELETE FROM reminders reminder
        WHERE reminder.group_id IN (SELECT id FROM candidate)
          AND reminder.status IN ('CANCELLED', 'DELIVERED')
          AND NOT EXISTS (
            SELECT 1 FROM user_reminder_ownership ownership
            WHERE ownership.reminder_id = reminder.id
          )
        RETURNING reminder.id
      ),
      deleted_terminal_proactive AS (
        DELETE FROM proactive_pushes proactive
        WHERE proactive.group_id IN (SELECT id FROM candidate)
          AND proactive.status IN ('CANCELLED', 'DELIVERED')
        RETURNING proactive.id
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id, actor_line_user_id, action, target_type, target_id, after_value, created_at
        )
        SELECT
          candidate.id,
          NULL,
          'GROUP_PRODUCT_DATA_PURGED',
          'LINE_GROUP',
          candidate.id::text,
          jsonb_build_object(
            'inactiveAt', candidate.inactive_at,
            'legacyHasPaid', candidate.has_paid,
            'reconciliationAnchorRetained', (SELECT retain FROM reconciliation_anchor),
            'userOwnedFinancialRecordsPreserved', true,
            'policy', CASE WHEN candidate.has_paid THEN 'LEGACY_PAID_1_YEAR' ELSE 'LEGACY_NEVER_PAID_30_DAYS' END
          ),
          ${command.at}
        FROM candidate
        RETURNING group_id
      ),
      retained_group AS (
        UPDATE line_groups group_state
        SET pending_message_count = 0,
            pending_char_count = 0,
            updated_at = ${command.at}
        FROM candidate
        WHERE group_state.id = candidate.id
          AND (SELECT retain FROM reconciliation_anchor)
        RETURNING group_state.id
      ),
      deleted_group AS (
        DELETE FROM line_groups group_state
        USING candidate
        WHERE group_state.id = candidate.id
          AND NOT (SELECT retain FROM reconciliation_anchor)
        RETURNING group_state.id
      )
      SELECT candidate.id::text AS group_id,
             (SELECT retain FROM reconciliation_anchor) AS retained_anchor
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
