import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  RewardedAdClaimState,
  UserRewardedAdRepository,
} from './rewarded-ad';

export class DrizzleUserRewardedAdRepository implements UserRewardedAdRepository {
  constructor(private readonly db: Database) {}

  async issueNonce(
    input: Parameters<UserRewardedAdRepository['issueNonce']>[0],
  ): Promise<'ISSUED' | 'USER_NOT_FOUND'> {
    const result = await this.db.execute(sql`
      INSERT INTO user_rewarded_ad_nonces (user_id, nonce_hash, expires_at, created_at)
      SELECT id, ${input.nonceHash}, ${input.expiresAt}, ${input.createdAt}
      FROM line_users
      WHERE line_user_id = ${input.lineUserId}
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) return 'ISSUED';
    const user = await this.db.execute(sql`
      SELECT id FROM line_users WHERE line_user_id = ${input.lineUserId} LIMIT 1
    `);
    return user.rows.length > 0 ? 'ISSUED' : 'USER_NOT_FOUND';
  }

  async claim(
    input: Parameters<UserRewardedAdRepository['claim']>[0],
  ): Promise<RewardedAdClaimState | { status: 'NONCE_INVALID' | 'USER_NOT_FOUND' | 'REFERENCE_CONFLICT' }> {
    const result = await this.db.execute(sql`
      WITH actor AS MATERIALIZED (
        SELECT id FROM line_users WHERE line_user_id = ${input.lineUserId} LIMIT 1
      ), existing_event AS MATERIALIZED (
        SELECT claim.id, claim.user_id, claim.status, claim.grant_operation_id
        FROM user_rewarded_ad_claims claim
        WHERE claim.provider = ${input.provider}
          AND claim.provider_event_id = ${input.providerEventId}
        LIMIT 1
      ), nonce AS MATERIALIZED (
        SELECT nonce.id, nonce.user_id, nonce.expires_at, nonce.consumed_at
        FROM user_rewarded_ad_nonces nonce
        JOIN actor ON actor.id = nonce.user_id
        WHERE nonce.nonce_hash = ${input.nonceHash}
        FOR UPDATE OF nonce
      ), policy AS (
        SELECT
          COALESCE((
            SELECT COUNT(*)::int
            FROM user_rewarded_ad_claims claim
            JOIN actor ON actor.id = claim.user_id
            WHERE claim.policy_day = ${input.policyDay}
              AND claim.status IN ('PENDING', 'GRANTED')
          ), 0) AS grant_count,
          (
            SELECT MAX(claim.accepted_at)
            FROM user_rewarded_ad_claims claim
            JOIN actor ON actor.id = claim.user_id
            WHERE claim.status IN ('PENDING', 'GRANTED')
          ) AS last_accepted_at
      ), accepted AS (
        SELECT
          nonce.id AS nonce_id,
          nonce.user_id,
          CASE
            WHEN policy.grant_count >= ${input.dailyLimit}
              OR (policy.last_accepted_at IS NOT NULL AND policy.last_accepted_at > ${input.cooldownBoundary})
            THEN 'REJECTED_POLICY'
            ELSE 'PENDING'
          END AS status
        FROM nonce
        CROSS JOIN policy
        WHERE nonce.consumed_at IS NULL
          AND nonce.expires_at > ${input.acceptedAt}
          AND NOT EXISTS (SELECT 1 FROM existing_event)
      ), inserted_claim AS (
        INSERT INTO user_rewarded_ad_claims (
          user_id, nonce_id, provider, provider_event_id, policy_day,
          status, accepted_at, created_at, updated_at
        )
        SELECT
          accepted.user_id, accepted.nonce_id, ${input.provider}, ${input.providerEventId},
          ${input.policyDay}, accepted.status, ${input.acceptedAt}, ${input.acceptedAt}, ${input.acceptedAt}
        FROM accepted
        ON CONFLICT DO NOTHING
        RETURNING id, user_id, status, grant_operation_id
      ), consumed_nonce AS (
        UPDATE user_rewarded_ad_nonces nonce
        SET consumed_at = ${input.acceptedAt}
        FROM inserted_claim claim
        WHERE nonce.id = (SELECT nonce_id FROM accepted)
        RETURNING nonce.id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM actor) THEN 'USER_NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM existing_event event JOIN actor ON actor.id <> event.user_id
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing_event) THEN (SELECT status FROM existing_event)
        WHEN NOT EXISTS (
          SELECT 1 FROM nonce
          WHERE consumed_at IS NULL AND expires_at > ${input.acceptedAt}
        ) THEN 'NONCE_INVALID'
        WHEN EXISTS (SELECT 1 FROM inserted_claim) THEN (SELECT status FROM inserted_claim)
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      COALESCE(
        (SELECT id::text FROM existing_event),
        (SELECT id::text FROM inserted_claim)
      ) AS id,
      COALESCE(
        (SELECT user_id::text FROM existing_event),
        (SELECT user_id::text FROM inserted_claim)
      ) AS user_id,
      COALESCE(
        (SELECT grant_operation_id::text FROM existing_event),
        (SELECT grant_operation_id::text FROM inserted_claim)
      ) AS grant_operation_id
    `);

    const row = result.rows[0] as {
      status?: string;
      id?: string | null;
      user_id?: string | null;
      grant_operation_id?: string | null;
    } | undefined;
    if (!row?.status) throw new Error('rewarded-ad claim returned no status');
    if (row.status === 'NONCE_INVALID' || row.status === 'USER_NOT_FOUND' || row.status === 'REFERENCE_CONFLICT') {
      return { status: row.status };
    }
    if (row.status !== 'PENDING' && row.status !== 'GRANTED' && row.status !== 'REJECTED_POLICY') {
      throw new Error(`unexpected rewarded-ad claim status: ${row.status}`);
    }
    if (!row.id || !row.user_id) throw new Error('rewarded-ad claim identity missing');
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      status: row.status,
      grantOperationId: row.grant_operation_id ? Number(row.grant_operation_id) : null,
    };
  }

  async completeGrant(
    claimId: number,
    operationId: number,
    grantedAt: Date,
  ): Promise<'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT'> {
    const result = await this.db.execute(sql`
      WITH existing AS MATERIALIZED (
        SELECT id, status, grant_operation_id
        FROM user_rewarded_ad_claims
        WHERE id = ${claimId}
        FOR UPDATE
      ), updated AS (
        UPDATE user_rewarded_ad_claims claim
        SET status = 'GRANTED',
            grant_operation_id = ${operationId},
            granted_at = ${grantedAt},
            updated_at = ${grantedAt}
        FROM existing
        WHERE claim.id = existing.id
          AND existing.status = 'PENDING'
          AND existing.grant_operation_id IS NULL
        RETURNING claim.id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM updated) THEN 'COMPLETED'
        WHEN EXISTS (
          SELECT 1 FROM existing WHERE status = 'GRANTED' AND grant_operation_id = ${operationId}
        ) THEN 'ALREADY_COMPLETED'
        ELSE 'CONFLICT'
      END AS status
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    if (status === 'COMPLETED' || status === 'ALREADY_COMPLETED' || status === 'CONFLICT') return status;
    throw new Error('rewarded-ad completion returned invalid status');
  }
}
