import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { formatTwdCostUnits, parseTwdCostUnits } from './allocation';
import type { RewardedAdClaim, RewardedAdRepository } from './rewarded-ad';

type RewardRow = {
  id: string;
  group_id: string;
  actor_line_user_id: string;
  reward_event_id: string;
  policy_day: string;
  amount_cost_twd: string;
  status: RewardedAdClaim['status'];
  grant_operation_id: string | null;
};

function mapReward(row: RewardRow): RewardedAdClaim {
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    actorLineUserId: row.actor_line_user_id,
    rewardEventId: row.reward_event_id,
    policyDay: row.policy_day,
    amountUnits: parseTwdCostUnits(row.amount_cost_twd),
    status: row.status,
    grantOperationId: row.grant_operation_id === null ? null : Number(row.grant_operation_id),
  };
}

export class DrizzleRewardedAdRepository implements RewardedAdRepository {
  constructor(private readonly db: Database) {}

  async claimReward(
    input: Parameters<RewardedAdRepository['claimReward']>[0],
  ): Promise<RewardedAdClaim> {
    const amount = formatTwdCostUnits(input.amountUnits);

    const run = async () => {
      const result = await this.db.execute(sql`
        WITH candidate AS (
          INSERT INTO rewarded_ad_grants (
            group_id,
            actor_line_user_id,
            reward_event_id,
            policy_day,
            amount_cost_twd,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ${input.groupId},
            ${input.actorLineUserId},
            ${input.rewardEventId},
            ${input.policyDay},
            CAST(${amount} AS numeric),
            'PENDING',
            ${input.acceptedAt},
            ${input.acceptedAt}
          )
          ON CONFLICT (group_id, reward_event_id) DO NOTHING
          RETURNING id
        ),
        policy_state AS (
          INSERT INTO rewarded_ad_policy_state (
            group_id,
            policy_day,
            grant_count,
            last_accepted_at,
            updated_at
          )
          SELECT
            ${input.groupId},
            ${input.policyDay},
            1,
            ${input.acceptedAt},
            ${input.acceptedAt}
          FROM candidate
          ON CONFLICT (group_id, policy_day) DO UPDATE
          SET grant_count = rewarded_ad_policy_state.grant_count + 1,
              last_accepted_at = ${input.acceptedAt},
              updated_at = ${input.acceptedAt}
          WHERE rewarded_ad_policy_state.grant_count < ${input.dailyLimit}
            AND (
              rewarded_ad_policy_state.last_accepted_at IS NULL
              OR rewarded_ad_policy_state.last_accepted_at <= ${input.cooldownBoundary}
            )
          RETURNING group_id
        ),
        rejected AS (
          UPDATE rewarded_ad_grants AS grant_row
          SET status = 'REJECTED_POLICY',
              updated_at = ${input.acceptedAt}
          FROM candidate
          WHERE grant_row.id = candidate.id
            AND NOT EXISTS (SELECT 1 FROM policy_state)
          RETURNING grant_row.id
        )
        SELECT
          grant_row.id::text AS id,
          grant_row.group_id::text AS group_id,
          grant_row.actor_line_user_id,
          grant_row.reward_event_id,
          grant_row.policy_day,
          grant_row.amount_cost_twd::text AS amount_cost_twd,
          grant_row.status,
          grant_row.grant_operation_id::text AS grant_operation_id
        FROM rewarded_ad_grants AS grant_row
        INNER JOIN candidate ON candidate.id = grant_row.id
        UNION ALL
        SELECT
          grant_row.id::text AS id,
          grant_row.group_id::text AS group_id,
          grant_row.actor_line_user_id,
          grant_row.reward_event_id,
          grant_row.policy_day,
          grant_row.amount_cost_twd::text AS amount_cost_twd,
          grant_row.status,
          grant_row.grant_operation_id::text AS grant_operation_id
        FROM rewarded_ad_grants AS grant_row
        WHERE grant_row.group_id = ${input.groupId}
          AND grant_row.reward_event_id = ${input.rewardEventId}
          AND NOT EXISTS (SELECT 1 FROM candidate)
        LIMIT 1
      `);
      return result.rows[0] as RewardRow | undefined;
    };

    const row = (await run()) ?? (await run());
    if (!row) throw new Error('failed to claim rewarded ad event');
    return mapReward(row);
  }

  async completeGrant(
    grantId: number,
    operationId: number,
    at: Date,
  ): Promise<'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT'> {
    const result = await this.db.execute(sql`
      WITH updated AS (
        UPDATE rewarded_ad_grants
        SET status = 'GRANTED',
            grant_operation_id = ${operationId},
            granted_at = ${at},
            updated_at = ${at}
        WHERE id = ${grantId}
          AND status = 'PENDING'
          AND grant_operation_id IS NULL
        RETURNING id, group_id, actor_line_user_id, amount_cost_twd, reward_event_id
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
          group_id,
          actor_line_user_id,
          'REWARDED_AD_GRANTED',
          'REWARDED_AD_GRANT',
          id::text,
          jsonb_build_object(
            'amountCostTwd', amount_cost_twd::text,
            'rewardEventId', reward_event_id,
            'operationId', ${operationId}
          ),
          ${at}
        FROM updated
        RETURNING id
      )
      SELECT 'COMPLETED'::text AS status
      FROM updated
      UNION ALL
      SELECT CASE
        WHEN status = 'GRANTED' AND grant_operation_id = ${operationId}
          THEN 'ALREADY_COMPLETED'
        ELSE 'CONFLICT'
      END AS status
      FROM rewarded_ad_grants
      WHERE id = ${grantId}
        AND NOT EXISTS (SELECT 1 FROM updated)
      LIMIT 1
    `);

    const row = result.rows[0] as
      | { status: 'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT' }
      | undefined;
    if (!row) throw new Error('rewarded ad grant not found during completion');
    return row.status;
  }
}
