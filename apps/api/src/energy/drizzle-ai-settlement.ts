import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  BackgroundAiSettlementRepository,
  BackgroundAiSettlementResult,
} from './ai-settlement';

const BUDGET_KEY = 'V1_FREE_AI';

export class DrizzleBackgroundAiSettlementRepository
  implements BackgroundAiSettlementRepository
{
  constructor(private readonly db: Database) {}

  async settle(
    input: Parameters<BackgroundAiSettlementRepository['settle']>[0],
  ): Promise<BackgroundAiSettlementResult> {
    const sharesJson = JSON.stringify(
      input.shares.map((share) => ({
        userId: share.userId,
        lineUserId: share.lineUserId,
        allocatedUnits: share.allocatedUnits.toString(),
      })),
    );

    const result = await this.db.execute(sql`
      WITH requested AS MATERIALIZED (
        SELECT *
        FROM jsonb_to_recordset(${sharesJson}::jsonb) AS share(
          "userId" bigint,
          "lineUserId" text,
          "allocatedUnits" text
        )
      ),
      requested_normalized AS (
        SELECT
          "userId" AS user_id,
          "lineUserId" AS line_user_id,
          "allocatedUnits"::bigint AS allocated_units
        FROM requested
      ),
      existing AS MATERIALIZED (
        SELECT user_id, line_user_id, allocated_units, charged_units, platform_subsidy_units
        FROM ai_user_energy_allocations
        WHERE request_id = ${input.requestId}
      ),
      existing_mismatch AS (
        SELECT 1
        WHERE EXISTS (
          SELECT 1
          FROM requested_normalized r
          FULL OUTER JOIN existing e USING (user_id, line_user_id, allocated_units)
          WHERE r.user_id IS NULL OR e.user_id IS NULL
        )
      ),
      budget_lock AS MATERIALIZED (
        INSERT INTO global_free_ai_budget_state (budget_key, spent_cost_twd, updated_at)
        VALUES (${BUDGET_KEY}, 0, ${input.at})
        ON CONFLICT (budget_key) DO UPDATE
        SET updated_at = global_free_ai_budget_state.updated_at
        RETURNING spent_cost_twd
      ),
      locked_lots AS MATERIALIZED (
        SELECT lot.id, lot.user_id, lot.bucket, lot.available_units, lot.expires_at
        FROM user_energy_lots lot
        JOIN requested_normalized requested ON requested.user_id = lot.user_id
        WHERE lot.available_units > 0
          AND (lot.expires_at IS NULL OR lot.expires_at > ${input.at})
        ORDER BY
          lot.user_id,
          CASE WHEN lot.expires_at IS NULL THEN 1 ELSE 0 END,
          lot.expires_at ASC NULLS LAST,
          CASE lot.bucket WHEN 'FREE' THEN 0 WHEN 'PAID' THEN 1 ELSE 0 END,
          lot.id
        FOR UPDATE OF lot
      ),
      balances AS (
        SELECT user_id, COALESCE(SUM(available_units), 0)::bigint AS current_units
        FROM locked_lots
        GROUP BY user_id
      ),
      desired AS (
        SELECT
          requested.user_id,
          requested.line_user_id,
          requested.allocated_units,
          LEAST(requested.allocated_units, COALESCE(balance.current_units, 0))::bigint AS charged_units,
          GREATEST(requested.allocated_units - COALESCE(balance.current_units, 0), 0)::bigint AS subsidy_units
        FROM requested_normalized requested
        LEFT JOIN balances balance ON balance.user_id = requested.user_id
      ),
      subsidy AS (
        SELECT COALESCE(SUM(subsidy_units), 0)::bigint AS units FROM desired
      ),
      subsidy_cost AS (
        SELECT CASE
          WHEN ${input.totalEnergyUnits.toString()}::bigint = 0 THEN 0::numeric
          ELSE ROUND(
            CAST(${input.totalCostTwd} AS numeric)
            * (SELECT units FROM subsidy)::numeric
            / ${input.totalEnergyUnits.toString()}::numeric,
            8
          )
        END AS cost_twd
      ),
      budget_ok AS (
        SELECT
          NOT EXISTS (SELECT 1 FROM existing)
          AND NOT EXISTS (SELECT 1 FROM existing_mismatch)
          AND (
            (SELECT cost_twd FROM subsidy_cost) = 0
            OR (SELECT spent_cost_twd FROM budget_lock)
                + (SELECT cost_twd FROM subsidy_cost)
                <= CAST(${input.globalFreeAiBudgetCostTwd} AS numeric)
          ) AS ok
      ),
      inserted_operations AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT
          desired.user_id,
          'CONSUME',
          desired.charged_units,
          'AI_MEMORY_CLASSIFIER',
          ${String(input.requestId)},
          jsonb_build_object(
            'groupId', ${input.groupId},
            'allocatedUnits', desired.allocated_units::text,
            'background', true
          ),
          ${input.at}
        FROM desired
        WHERE desired.charged_units > 0
          AND (SELECT ok FROM budget_ok)
        ON CONFLICT DO NOTHING
        RETURNING id, user_id, requested_units
      ),
      ordered_lots AS (
        SELECT
          lot.*,
          desired.charged_units,
          COALESCE(SUM(lot.available_units) OVER (
            PARTITION BY lot.user_id
            ORDER BY
              CASE WHEN lot.expires_at IS NULL THEN 1 ELSE 0 END,
              lot.expires_at ASC NULLS LAST,
              CASE lot.bucket WHEN 'FREE' THEN 0 WHEN 'PAID' THEN 1 ELSE 0 END,
              lot.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0)::bigint AS before_units
        FROM locked_lots lot
        JOIN desired ON desired.user_id = lot.user_id
      ),
      lot_allocation AS (
        SELECT
          lot.id,
          lot.user_id,
          lot.bucket,
          LEAST(lot.available_units, GREATEST(lot.charged_units - lot.before_units, 0))::bigint AS units
        FROM ordered_lots lot
      ),
      updated_lots AS (
        UPDATE user_energy_lots lot
        SET available_units = lot.available_units - allocation.units,
            updated_at = ${input.at}
        FROM lot_allocation allocation
        JOIN inserted_operations operation ON operation.user_id = allocation.user_id
        WHERE lot.id = allocation.id
          AND allocation.units > 0
        RETURNING lot.id, lot.user_id, lot.bucket, allocation.units
      ),
      transactions AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT
          operation.id, updated.user_id, updated.id, updated.bucket,
          'CONSUME', updated.units, ${input.at}
        FROM updated_lots updated
        JOIN inserted_operations operation ON operation.user_id = updated.user_id
        ON CONFLICT DO NOTHING
        RETURNING id
      ),
      inserted_allocations AS (
        INSERT INTO ai_user_energy_allocations (
          request_id, group_id, user_id, line_user_id,
          allocated_units, charged_units, platform_subsidy_units,
          charge_operation_id, created_at
        )
        SELECT
          ${input.requestId}, ${input.groupId}, desired.user_id, desired.line_user_id,
          desired.allocated_units, desired.charged_units, desired.subsidy_units,
          operation.id, ${input.at}
        FROM desired
        LEFT JOIN inserted_operations operation ON operation.user_id = desired.user_id
        WHERE (SELECT ok FROM budget_ok)
        ON CONFLICT DO NOTHING
        RETURNING user_id, charged_units, platform_subsidy_units
      ),
      subsidy_audit AS (
        INSERT INTO platform_ai_subsidy_operations (
          request_id, user_id, units, budget_key, created_at
        )
        SELECT ${input.requestId}, desired.user_id, desired.subsidy_units, ${BUDGET_KEY}, ${input.at}
        FROM desired
        WHERE desired.subsidy_units > 0
          AND (SELECT ok FROM budget_ok)
        ON CONFLICT DO NOTHING
        RETURNING units
      ),
      budget_update AS (
        UPDATE global_free_ai_budget_state budget
        SET spent_cost_twd = budget.spent_cost_twd + (SELECT cost_twd FROM subsidy_cost),
            updated_at = ${input.at}
        WHERE budget.budget_key = ${BUDGET_KEY}
          AND (SELECT ok FROM budget_ok)
          AND (SELECT cost_twd FROM subsidy_cost) > 0
          AND (SELECT COUNT(*) FROM inserted_allocations) = (SELECT COUNT(*) FROM desired)
        RETURNING budget.spent_cost_twd
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM existing_mismatch) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_SETTLED'
        WHEN NOT (SELECT ok FROM budget_ok) THEN 'FREE_AI_BUDGET_EXHAUSTED'
        WHEN (SELECT COUNT(*) FROM inserted_allocations) = (SELECT COUNT(*) FROM desired) THEN 'SETTLED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status,
      COALESCE(
        (SELECT SUM(charged_units)::text FROM inserted_allocations),
        (SELECT SUM(charged_units)::text FROM existing), '0'
      ) AS user_charged_units,
      COALESCE(
        (SELECT SUM(platform_subsidy_units)::text FROM inserted_allocations),
        (SELECT SUM(platform_subsidy_units)::text FROM existing), '0'
      ) AS platform_subsidy_units
    `);

    const row = result.rows[0] as {
      status?: BackgroundAiSettlementResult['status'];
      user_charged_units?: string;
      platform_subsidy_units?: string;
    } | undefined;
    if (!row?.status) throw new Error('background AI Energy settlement returned no result');
    return {
      status: row.status,
      userChargedUnits: BigInt(row.user_charged_units ?? '0'),
      platformSubsidyUnits: BigInt(row.platform_subsidy_units ?? '0'),
    };
  }
}
