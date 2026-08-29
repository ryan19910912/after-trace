import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { MemoryRecoveryRepository } from './recovery';

export class DrizzleMemoryRecoveryRepository implements MemoryRecoveryRepository {
  constructor(private readonly db: Database) {}

  async requeueFailed(input: {
    requestId: number;
    expectedAttemptCount: number;
    operatorRef: string;
    reason: string;
    requeuedAt: Date;
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT
          request.id,
          request.group_id,
          request.origin,
          request.extraction_batch_id,
          request.last_error_code,
          work.attempt_count,
          work.transient_failure_count
        FROM memory_candidate_requests request
        JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.id = ${input.requestId}
          AND request.status = 'FAILED'
          AND work.attempt_count = ${input.expectedAttemptCount}
        FOR UPDATE OF request, work
      ),
      reopened_batch AS (
        UPDATE conversation_extraction_batches batch
        SET status = 'CLAIMED',
            active_claim_key = NULL,
            completed_at = NULL,
            lease_expires_at = ${input.requeuedAt},
            last_error_code = NULL,
            updated_at = ${input.requeuedAt}
        FROM target
        WHERE target.origin = 'AUTOMATIC'
          AND target.extraction_batch_id IS NOT NULL
          AND batch.id = target.extraction_batch_id
          AND batch.status = 'FAILED'
        RETURNING batch.id
      ),
      requeueable AS MATERIALIZED (
        SELECT target.*
        FROM target
        WHERE target.origin = 'EXPLICIT'
           OR EXISTS (SELECT 1 FROM reopened_batch)
      ),
      reset_work AS (
        UPDATE memory_request_work_states work
        SET transient_failure_count = 0,
            claimed_at = NULL,
            lease_expires_at = NULL,
            completed_at = NULL,
            last_error_code = NULL,
            updated_at = ${input.requeuedAt}
        FROM requeueable
        WHERE work.request_id = requeueable.id
        RETURNING work.request_id
      ),
      requeued AS (
        UPDATE memory_candidate_requests request
        SET status = 'PENDING',
            last_error_code = NULL,
            updated_at = ${input.requeuedAt}
        FROM requeueable, reset_work
        WHERE request.id = requeueable.id
          AND reset_work.request_id = requeueable.id
        RETURNING request.id, request.group_id
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id,
          actor_line_user_id,
          action,
          target_type,
          target_id,
          before_value,
          after_value,
          created_at
        )
        SELECT
          requeueable.group_id,
          NULL,
          'MEMORY_REQUEST_REQUEUED',
          'MEMORY_REQUEST',
          requeueable.id::text,
          jsonb_build_object(
            'status', 'FAILED',
            'attemptCount', requeueable.attempt_count,
            'transientFailureCount', requeueable.transient_failure_count,
            'lastErrorCode', requeueable.last_error_code
          ),
          jsonb_build_object(
            'status', 'PENDING',
            'attemptCount', requeueable.attempt_count,
            'transientFailureCount', 0,
            'operatorRef', ${input.operatorRef},
            'reason', ${input.reason}
          ),
          ${input.requeuedAt}
        FROM requeueable
        JOIN requeued ON requeued.id = requeueable.id
        RETURNING id
      )
      SELECT requeued.id
      FROM requeued
      WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows.length === 1;
  }
}
