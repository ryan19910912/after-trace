import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ExtractionBatchClaim,
  ExtractionClaimRepository,
  ExtractionClaimThresholds,
} from './service';

type ClaimRow = {
  batch_id: string;
  group_id: string;
  message_count: number;
  char_count: number;
  first_message_id: string;
  last_message_id: string;
  attempt_count: number;
  lease_expires_at: Date | string;
};

function mapClaim(row: ClaimRow): ExtractionBatchClaim {
  return {
    id: Number(row.batch_id),
    groupId: Number(row.group_id),
    messageCount: Number(row.message_count),
    charCount: Number(row.char_count),
    firstMessageId: Number(row.first_message_id),
    lastMessageId: Number(row.last_message_id),
    attemptCount: Number(row.attempt_count),
    leaseExpiresAt:
      row.lease_expires_at instanceof Date
        ? row.lease_expires_at
        : new Date(row.lease_expires_at),
  };
}

export class DrizzleExtractionClaimRepository implements ExtractionClaimRepository {
  constructor(private readonly db: Database) {}

  async claimDueBatch(
    groupId: number,
    now: Date,
    leaseUntil: Date,
    thresholds: ExtractionClaimThresholds,
  ): Promise<ExtractionBatchClaim | null> {
    const reclaimed = await this.db.execute(sql`
      WITH candidate AS (
        SELECT id
        FROM conversation_extraction_batches
        WHERE group_id = ${groupId}
          AND status = 'CLAIMED'
          AND active_claim_key = 'OPEN'
          AND lease_expires_at <= ${now}
        ORDER BY claimed_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE conversation_extraction_batches AS batch
      SET lease_expires_at = ${leaseUntil},
          attempt_count = batch.attempt_count + 1,
          claimed_at = ${now},
          last_error_code = NULL,
          updated_at = ${now}
      FROM candidate
      WHERE batch.id = candidate.id
      RETURNING
        batch.id::text AS batch_id,
        batch.group_id::text AS group_id,
        batch.message_count,
        batch.char_count,
        batch.first_message_id::text AS first_message_id,
        batch.last_message_id::text AS last_message_id,
        batch.attempt_count,
        batch.lease_expires_at
    `);

    const reclaimedRow = reclaimed.rows[0] as ClaimRow | undefined;
    if (reclaimedRow) return mapClaim(reclaimedRow);

    const created = await this.db.execute(sql`
      WITH candidate AS (
        SELECT message.id, message.char_count
        FROM conversation_messages AS message
        INNER JOIN line_groups AS group_row ON group_row.id = message.group_id
        WHERE message.group_id = ${groupId}
          AND group_row.status = 'ACTIVE'
          AND message.extraction_batch_id IS NULL
      ),
      stats AS (
        SELECT
          COUNT(*)::int AS message_count,
          COALESCE(SUM(char_count), 0)::int AS char_count,
          MIN(id)::bigint AS first_message_id,
          MAX(id)::bigint AS last_message_id,
          COALESCE(MAX(char_count), 0)::int AS largest_message_chars
        FROM candidate
      ),
      batch AS (
        INSERT INTO conversation_extraction_batches (
          group_id,
          status,
          active_claim_key,
          message_count,
          char_count,
          first_message_id,
          last_message_id,
          attempt_count,
          claimed_at,
          lease_expires_at,
          created_at,
          updated_at
        )
        SELECT
          ${groupId},
          'CLAIMED',
          'OPEN',
          stats.message_count,
          stats.char_count,
          stats.first_message_id,
          stats.last_message_id,
          1,
          ${now},
          ${leaseUntil},
          ${now},
          ${now}
        FROM stats
        WHERE stats.message_count > 0
          AND (
            stats.message_count >= ${thresholds.messageThreshold}
            OR stats.char_count >= ${thresholds.charThreshold}
            OR stats.largest_message_chars >= ${thresholds.largeMessageChars}
          )
        ON CONFLICT DO NOTHING
        RETURNING *
      ),
      assigned AS (
        UPDATE conversation_messages AS message
        SET extraction_batch_id = batch.id
        FROM batch
        WHERE message.id IN (SELECT id FROM candidate)
          AND message.extraction_batch_id IS NULL
        RETURNING message.id, message.char_count, batch.id AS batch_id
      ),
      assigned_stats AS (
        SELECT
          batch_id,
          COUNT(*)::int AS message_count,
          COALESCE(SUM(char_count), 0)::int AS char_count
        FROM assigned
        GROUP BY batch_id
      ),
      counters AS (
        UPDATE line_groups AS group_row
        SET pending_message_count = GREATEST(
              group_row.pending_message_count - assigned_stats.message_count,
              0
            ),
            pending_char_count = GREATEST(
              group_row.pending_char_count - assigned_stats.char_count,
              0
            ),
            updated_at = ${now}
        FROM assigned_stats
        WHERE group_row.id = ${groupId}
        RETURNING group_row.id
      )
      SELECT
        batch.id::text AS batch_id,
        batch.group_id::text AS group_id,
        batch.message_count,
        batch.char_count,
        batch.first_message_id::text AS first_message_id,
        batch.last_message_id::text AS last_message_id,
        batch.attempt_count,
        batch.lease_expires_at
      FROM batch
      INNER JOIN assigned_stats ON assigned_stats.batch_id = batch.id
    `);

    const createdRow = created.rows[0] as ClaimRow | undefined;
    return createdRow ? mapClaim(createdRow) : null;
  }

  async markSucceeded(batchId: number, completedAt: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE conversation_extraction_batches
      SET status = 'SUCCEEDED',
          active_claim_key = NULL,
          completed_at = ${completedAt},
          updated_at = ${completedAt},
          last_error_code = NULL
      WHERE id = ${batchId}
        AND status = 'CLAIMED'
        AND active_claim_key = 'OPEN'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async markTerminalSkipped(batchId: number, completedAt: Date, errorCode: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE conversation_extraction_batches
      SET status = 'FAILED',
          active_claim_key = NULL,
          completed_at = ${completedAt},
          updated_at = ${completedAt},
          last_error_code = ${errorCode}
      WHERE id = ${batchId}
        AND status = 'CLAIMED'
        AND active_claim_key = 'OPEN'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async deferFailure(batchId: number, retryAt: Date, errorCode: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE conversation_extraction_batches
      SET lease_expires_at = ${retryAt},
          last_error_code = ${errorCode},
          updated_at = NOW()
      WHERE id = ${batchId}
        AND status = 'CLAIMED'
        AND active_claim_key = 'OPEN'
      RETURNING id
    `);
    return result.rows.length > 0;
  }
}
