import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ProactiveClaimResult,
  ProactiveDispatchClaim,
  ProactiveEnqueueResult,
  ProactiveRepository,
} from './service';

type EnqueueRow = { status: ProactiveEnqueueResult['status']; push_id: string | null };

type ClaimRow = {
  status: 'CLAIMED' | 'CANCELLED_INELIGIBLE' | 'NO_WORK';
  push_id: string | null;
  user_id: string | null;
  group_id: string | null;
  line_group_id: string | null;
  message: string | null;
  delivery_attempt_count: number | null;
  delivery_retry_key: string | null;
};

export class DrizzleProactiveRepository implements ProactiveRepository {
  constructor(private readonly db: Database) {}

  async enqueue(
    input: Parameters<ProactiveRepository['enqueue']>[0],
  ): Promise<ProactiveEnqueueResult> {
    const result = await this.db.execute(sql`
      WITH owner AS (
        SELECT id FROM line_users WHERE line_user_id = ${input.ownerLineUserId} LIMIT 1
      ), destination AS (
        SELECT id, status FROM line_groups WHERE line_group_id = ${input.lineGroupId} LIMIT 1
      ), member AS (
        SELECT 1
        FROM group_members
        WHERE group_id = (SELECT id FROM destination)
          AND line_user_id = ${input.ownerLineUserId}
          AND is_active = TRUE
      ), capability AS (
        SELECT EXISTS (
          SELECT 1
          FROM user_energy_lots
          WHERE user_id = (SELECT id FROM owner)
            AND bucket IN ('SUBSCRIPTION', 'PAID')
            AND available_units > 0
            AND (expires_at IS NULL OR expires_at > ${input.at})
        ) AS ok
      ), existing AS (
        SELECT *
        FROM proactive_pushes
        WHERE user_id = (SELECT id FROM owner)
          AND request_key = ${input.requestKey}
        LIMIT 1
      ), inserted AS (
        INSERT INTO proactive_pushes (
          user_id, group_id, request_key, source_type, source_id,
          message, scheduled_for, status, created_at, updated_at
        )
        SELECT
          owner.id, destination.id, ${input.requestKey}, ${input.sourceType}, ${input.sourceId},
          ${input.message}, ${input.scheduledFor}, 'SCHEDULED', ${input.at}, ${input.at}
        FROM owner CROSS JOIN destination
        WHERE destination.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM member)
          AND (SELECT ok FROM capability)
          AND NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM owner) THEN 'OWNER_NOT_FOUND'
        WHEN NOT EXISTS (SELECT 1 FROM destination) THEN 'GROUP_NOT_FOUND'
        WHEN EXISTS (SELECT 1 FROM destination WHERE status <> 'ACTIVE') THEN 'GROUP_INACTIVE'
        WHEN NOT EXISTS (SELECT 1 FROM member) THEN 'OWNER_NOT_GROUP_MEMBER'
        WHEN NOT (SELECT ok FROM capability) THEN 'PROACTIVE_NOT_AVAILABLE'
        WHEN EXISTS (
          SELECT 1 FROM existing
          WHERE group_id <> (SELECT id FROM destination)
             OR source_type <> ${input.sourceType}
             OR source_id <> ${input.sourceId}
             OR message <> ${input.message}
             OR scheduled_for IS DISTINCT FROM ${input.scheduledFor}
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_CREATED'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'CREATED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      COALESCE((SELECT id::text FROM existing), (SELECT id::text FROM inserted)) AS push_id
    `);
    const row = result.rows[0] as EnqueueRow | undefined;
    if (!row) throw new Error('proactive enqueue returned no result');
    return { status: row.status, pushId: row.push_id === null ? null : Number(row.push_id) } as ProactiveEnqueueResult;
  }

  async claimNext(at: Date, leaseUntil: Date, retryKey: string): Promise<ProactiveClaimResult> {
    const result = await this.db.execute(sql`
      WITH candidate AS MATERIALIZED (
        SELECT push.id, push.user_id, push.group_id, push.message,
               push.delivery_attempt_count, group_row.line_group_id,
               group_row.status AS group_status,
               member.is_active AS member_active,
               EXISTS (
                 SELECT 1
                 FROM user_energy_lots lot
                 WHERE lot.user_id = push.user_id
                   AND lot.bucket IN ('SUBSCRIPTION', 'PAID')
                   AND lot.available_units > 0
                   AND (lot.expires_at IS NULL OR lot.expires_at > ${at})
               ) AS capability
        FROM proactive_pushes push
        JOIN line_groups group_row ON group_row.id = push.group_id
        LEFT JOIN line_users owner ON owner.id = push.user_id
        LEFT JOIN group_members member
          ON member.group_id = push.group_id
         AND member.line_user_id = owner.line_user_id
        WHERE push.status = 'SCHEDULED'
          AND push.scheduled_for <= ${at}
          AND (push.delivery_lease_expires_at IS NULL OR push.delivery_lease_expires_at <= ${at})
        ORDER BY push.scheduled_for, push.id
        FOR UPDATE OF push SKIP LOCKED
        LIMIT 1
      ), cancelled AS (
        UPDATE proactive_pushes push
        SET status = 'CANCELLED',
            cancelled_at = ${at},
            last_error_code = 'PROACTIVE_OWNER_INELIGIBLE',
            updated_at = ${at}
        FROM candidate
        WHERE push.id = candidate.id
          AND (
            candidate.group_status <> 'ACTIVE'
            OR candidate.member_active IS DISTINCT FROM TRUE
            OR candidate.capability = FALSE
          )
        RETURNING push.id
      ), claimed AS (
        UPDATE proactive_pushes push
        SET status = 'DISPATCHING',
            delivery_attempt_count = push.delivery_attempt_count + 1,
            delivery_retry_key = ${retryKey},
            delivery_lease_expires_at = ${leaseUntil},
            last_error_code = NULL,
            updated_at = ${at}
        FROM candidate
        WHERE push.id = candidate.id
          AND candidate.group_status = 'ACTIVE'
          AND candidate.member_active = TRUE
          AND candidate.capability = TRUE
          AND NOT EXISTS (SELECT 1 FROM cancelled)
        RETURNING push.id, push.user_id, push.group_id, push.message,
                  push.delivery_attempt_count, push.delivery_retry_key
      )
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM claimed) THEN 'CLAIMED'
          WHEN EXISTS (SELECT 1 FROM cancelled) THEN 'CANCELLED_INELIGIBLE'
          ELSE 'NO_WORK'
        END AS status,
        COALESCE((SELECT id::text FROM claimed), (SELECT id::text FROM cancelled)) AS push_id,
        (SELECT user_id::text FROM claimed) AS user_id,
        (SELECT group_id::text FROM claimed) AS group_id,
        (SELECT line_group_id FROM candidate) AS line_group_id,
        (SELECT message FROM claimed) AS message,
        (SELECT delivery_attempt_count FROM claimed) AS delivery_attempt_count,
        (SELECT delivery_retry_key FROM claimed) AS delivery_retry_key
    `);

    const row = result.rows[0] as ClaimRow | undefined;
    if (!row || row.status === 'NO_WORK') return { status: 'NO_WORK' };
    if (row.status === 'CANCELLED_INELIGIBLE') {
      return { status: 'CANCELLED_INELIGIBLE', pushId: Number(row.push_id) };
    }
    if (!row.push_id || !row.user_id || !row.group_id || !row.line_group_id || !row.message || !row.delivery_attempt_count || !row.delivery_retry_key) {
      throw new Error('proactive claim returned incomplete data');
    }
    return {
      status: 'CLAIMED',
      claim: {
        pushId: Number(row.push_id),
        userId: Number(row.user_id),
        groupId: Number(row.group_id),
        lineGroupId: row.line_group_id,
        message: row.message,
        attemptCount: row.delivery_attempt_count,
        retryKey: row.delivery_retry_key,
      },
    };
  }

  async markDelivered(claim: ProactiveDispatchClaim, at: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE proactive_pushes
      SET status = 'DELIVERED',
          delivered_at = ${at},
          delivery_lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = ${at}
      WHERE id = ${claim.pushId}
        AND user_id = ${claim.userId}
        AND group_id = ${claim.groupId}
        AND status = 'DISPATCHING'
        AND delivery_attempt_count = ${claim.attemptCount}
        AND delivery_retry_key = ${claim.retryKey}
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async releaseForRetry(claim: ProactiveDispatchClaim, at: Date, errorCode: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE proactive_pushes
      SET status = 'SCHEDULED',
          delivery_lease_expires_at = ${at},
          last_error_code = ${errorCode.slice(0, 128)},
          updated_at = ${at}
      WHERE id = ${claim.pushId}
        AND status = 'DISPATCHING'
        AND delivery_attempt_count = ${claim.attemptCount}
        AND delivery_retry_key = ${claim.retryKey}
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async cancelFailed(claim: ProactiveDispatchClaim, at: Date, errorCode: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE proactive_pushes
      SET status = 'CANCELLED',
          cancelled_at = ${at},
          delivery_lease_expires_at = NULL,
          last_error_code = ${errorCode.slice(0, 128)},
          updated_at = ${at}
      WHERE id = ${claim.pushId}
        AND status = 'DISPATCHING'
        AND delivery_attempt_count = ${claim.attemptCount}
        AND delivery_retry_key = ${claim.retryKey}
      RETURNING id
    `);
    return result.rows.length === 1;
  }
}
