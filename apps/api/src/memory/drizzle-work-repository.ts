import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ClaimedMemoryRequest, MemoryWorkRepository } from './work';

type ClaimRow = {
  id: string;
  group_id: string;
  origin: ClaimedMemoryRequest['origin'];
  extraction_batch_id: string | null;
  actor_line_user_id: string | null;
  source_conversation_message_id: string | null;
  instruction: string | null;
  attempt_count: number;
  lease_expires_at: Date;
};

export class DrizzleMemoryWorkRepository implements MemoryWorkRepository {
  constructor(private readonly db: Database) {}

  async claimNextForGroup(
    groupId: number,
    now: Date,
    leaseUntil: Date,
  ): Promise<ClaimedMemoryRequest | null> {
    const result = await this.db.execute(sql`
      WITH candidate AS MATERIALIZED (
        SELECT request.id
        FROM memory_candidate_requests request
        LEFT JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.group_id = ${groupId}
          AND (
            (request.status = 'PENDING' AND (work.lease_expires_at IS NULL OR work.lease_expires_at <= ${now}))
            OR (request.status = 'CLAIMED' AND work.lease_expires_at <= ${now})
          )
        ORDER BY request.created_at ASC, request.id ASC
        FOR UPDATE OF request SKIP LOCKED
        LIMIT 1
      ),
      work_state AS (
        INSERT INTO memory_request_work_states (
          request_id,
          attempt_count,
          claimed_at,
          lease_expires_at,
          completed_at,
          last_error_code,
          updated_at
        )
        SELECT candidate.id, 1, ${now}, ${leaseUntil}, NULL, NULL, ${now}
        FROM candidate
        ON CONFLICT (request_id) DO UPDATE
        SET attempt_count = memory_request_work_states.attempt_count + 1,
            claimed_at = EXCLUDED.claimed_at,
            lease_expires_at = EXCLUDED.lease_expires_at,
            completed_at = NULL,
            last_error_code = NULL,
            updated_at = EXCLUDED.updated_at
        RETURNING request_id, attempt_count, lease_expires_at
      )
      UPDATE memory_candidate_requests request
      SET status = 'CLAIMED',
          last_error_code = NULL,
          updated_at = ${now}
      FROM work_state
      WHERE request.id = work_state.request_id
      RETURNING
        request.id::text AS id,
        request.group_id::text AS group_id,
        request.origin,
        request.extraction_batch_id::text AS extraction_batch_id,
        request.actor_line_user_id,
        request.source_conversation_message_id::text AS source_conversation_message_id,
        request.instruction,
        work_state.attempt_count,
        work_state.lease_expires_at
    `);

    const row = result.rows[0] as ClaimRow | undefined;
    if (!row) return null;
    return mapClaim(row);
  }

  async markSucceeded(
    requestId: number,
    attemptCount: number,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      WITH owned AS MATERIALIZED (
        SELECT request.id, request.origin, request.extraction_batch_id
        FROM memory_candidate_requests request
        JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.id = ${requestId}
          AND request.status = 'CLAIMED'
          AND work.attempt_count = ${attemptCount}
        FOR UPDATE OF request, work
      ),
      completed_work AS (
        UPDATE memory_request_work_states work
        SET completed_at = ${completedAt},
            lease_expires_at = NULL,
            last_error_code = NULL,
            updated_at = ${completedAt}
        FROM owned
        WHERE work.request_id = owned.id
        RETURNING work.request_id
      ),
      completed_request AS (
        UPDATE memory_candidate_requests request
        SET status = 'SUCCEEDED',
            last_error_code = NULL,
            updated_at = ${completedAt}
        FROM completed_work, owned
        WHERE request.id = completed_work.request_id
          AND request.id = owned.id
        RETURNING request.id, request.origin, request.extraction_batch_id
      ),
      completed_batch AS (
        UPDATE conversation_extraction_batches batch
        SET status = 'SUCCEEDED',
            active_claim_key = NULL,
            completed_at = ${completedAt},
            lease_expires_at = ${completedAt},
            last_error_code = NULL,
            updated_at = ${completedAt}
        FROM completed_request request
        WHERE request.origin = 'AUTOMATIC'
          AND request.extraction_batch_id IS NOT NULL
          AND batch.id = request.extraction_batch_id
          AND batch.status = 'CLAIMED'
        RETURNING batch.id
      )
      SELECT id FROM completed_request
    `);
    return result.rows.length === 1;
  }

  async deferFailure(
    requestId: number,
    attemptCount: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      WITH owned AS MATERIALIZED (
        SELECT request.id
        FROM memory_candidate_requests request
        JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.id = ${requestId}
          AND request.status = 'CLAIMED'
          AND work.attempt_count = ${attemptCount}
        FOR UPDATE OF request, work
      ),
      deferred_work AS (
        UPDATE memory_request_work_states work
        SET lease_expires_at = ${retryAt},
            last_error_code = ${errorCode},
            updated_at = NOW()
        FROM owned
        WHERE work.request_id = owned.id
        RETURNING work.request_id
      )
      UPDATE memory_candidate_requests request
      SET status = 'PENDING',
          last_error_code = ${errorCode},
          updated_at = NOW()
      FROM deferred_work
      WHERE request.id = deferred_work.request_id
      RETURNING request.id
    `);
    return result.rows.length === 1;
  }
}

function mapClaim(row: ClaimRow): ClaimedMemoryRequest {
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    origin: row.origin,
    extractionBatchId: row.extraction_batch_id === null ? null : Number(row.extraction_batch_id),
    actorLineUserId: row.actor_line_user_id,
    sourceConversationMessageId:
      row.source_conversation_message_id === null ? null : Number(row.source_conversation_message_id),
    instruction: row.instruction,
    attemptCount: row.attempt_count,
    leaseExpiresAt: new Date(row.lease_expires_at),
  };
}
