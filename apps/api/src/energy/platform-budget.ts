import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

const BUDGET_KEY = 'V1_FREE_AI';

export type PlatformBudgetReservationResult =
  | { status: 'RESERVED' | 'ALREADY_RESERVED' }
  | { status: 'BUDGET_EXHAUSTED' | 'REFERENCE_CONFLICT' };

export class DrizzlePlatformAiBudgetReservationRepository {
  constructor(private readonly db: Database) {}

  async reserve(input: {
    requestId: number;
    groupId: number;
    maxSubsidyCostTwd: number;
    globalBudgetCostTwd: number;
    at: Date;
  }): Promise<PlatformBudgetReservationResult> {
    const max = input.maxSubsidyCostTwd.toFixed(8);
    const budget = input.globalBudgetCostTwd.toFixed(8);
    const result = await this.db.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${BUDGET_KEY}));
      INSERT INTO global_free_ai_budget_state (budget_key, spent_cost_twd, updated_at)
      VALUES (${BUDGET_KEY}, 0, ${input.at})
      ON CONFLICT (budget_key) DO NOTHING;
    `);
    void result;

    const state = await this.db.execute(sql`
      WITH existing AS MATERIALIZED (
        SELECT request_id, group_id, reserved_cost_twd, status
        FROM platform_ai_budget_reservations
        WHERE request_id = ${input.requestId}
      ), totals AS (
        SELECT
          COALESCE((SELECT spent_cost_twd FROM global_free_ai_budget_state WHERE budget_key = ${BUDGET_KEY}), 0) AS spent,
          COALESCE(SUM(reserved_cost_twd), 0) AS reserved
        FROM platform_ai_budget_reservations
        WHERE budget_key = ${BUDGET_KEY}
          AND status = 'RESERVED'
          AND request_id <> ${input.requestId}
      ), inserted AS (
        INSERT INTO platform_ai_budget_reservations (
          request_id, group_id, budget_key, reserved_cost_twd, status, created_at, updated_at
        )
        SELECT ${input.requestId}, ${input.groupId}, ${BUDGET_KEY}, CAST(${max} AS numeric), 'RESERVED', ${input.at}, ${input.at}
        FROM totals
        WHERE NOT EXISTS (SELECT 1 FROM existing)
          AND spent + reserved + CAST(${max} AS numeric) <= CAST(${budget} AS numeric)
        ON CONFLICT DO NOTHING
        RETURNING request_id
      )
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM existing
          WHERE group_id <> ${input.groupId}
             OR reserved_cost_twd <> CAST(${max} AS numeric)
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing WHERE status = 'RESERVED') THEN 'ALREADY_RESERVED'
        WHEN EXISTS (SELECT 1 FROM existing WHERE status IN ('SETTLED', 'RELEASED')) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'RESERVED'
        ELSE 'BUDGET_EXHAUSTED'
      END AS status
    `);
    const status = String((state.rows[0] as { status?: string } | undefined)?.status ?? 'REFERENCE_CONFLICT');
    return { status: status as PlatformBudgetReservationResult['status'] } as PlatformBudgetReservationResult;
  }

  async release(requestId: number, at = new Date()): Promise<void> {
    await this.db.execute(sql`
      UPDATE platform_ai_budget_reservations
      SET status = 'RELEASED', updated_at = ${at}
      WHERE request_id = ${requestId}
        AND status = 'RESERVED'
    `);
  }

  async settle(requestId: number, actualSubsidyCostTwd: string, at = new Date()): Promise<'SETTLED' | 'ALREADY_SETTLED' | 'REFERENCE_CONFLICT'> {
    const result = await this.db.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${BUDGET_KEY}));
      WITH reservation AS MATERIALIZED (
        SELECT request_id, reserved_cost_twd, status, actual_subsidy_cost_twd
        FROM platform_ai_budget_reservations
        WHERE request_id = ${requestId}
        FOR UPDATE
      ), valid AS (
        SELECT * FROM reservation
        WHERE status = 'RESERVED'
          AND CAST(${actualSubsidyCostTwd} AS numeric) <= reserved_cost_twd
      ), budget AS (
        UPDATE global_free_ai_budget_state
        SET spent_cost_twd = spent_cost_twd + CAST(${actualSubsidyCostTwd} AS numeric),
            updated_at = ${at}
        WHERE budget_key = ${BUDGET_KEY}
          AND EXISTS (SELECT 1 FROM valid)
        RETURNING budget_key
      ), settled AS (
        UPDATE platform_ai_budget_reservations
        SET status = 'SETTLED',
            actual_subsidy_cost_twd = CAST(${actualSubsidyCostTwd} AS numeric),
            updated_at = ${at}
        WHERE request_id = ${requestId}
          AND status = 'RESERVED'
          AND EXISTS (SELECT 1 FROM budget)
        RETURNING request_id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM settled) THEN 'SETTLED'
        WHEN EXISTS (
          SELECT 1 FROM reservation
          WHERE status = 'SETTLED'
            AND actual_subsidy_cost_twd = CAST(${actualSubsidyCostTwd} AS numeric)
        ) THEN 'ALREADY_SETTLED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status
    `);
    return String((result.rows[0] as { status?: string } | undefined)?.status ?? 'REFERENCE_CONFLICT') as 'SETTLED' | 'ALREADY_SETTLED' | 'REFERENCE_CONFLICT';
  }
}

export class PlatformAiBudgetGate {
  constructor(
    private readonly repository: DrizzlePlatformAiBudgetReservationRepository,
    private readonly maxSubsidyCostTwd: number,
    private readonly globalBudgetCostTwd: number,
  ) {
    if (!Number.isFinite(maxSubsidyCostTwd) || maxSubsidyCostTwd <= 0) throw new Error('BACKGROUND_AI_MAX_SUBSIDY_COST_TWD must be positive');
    if (!Number.isFinite(globalBudgetCostTwd) || globalBudgetCostTwd <= 0) throw new Error('GLOBAL_FREE_AI_BUDGET_COST_TWD must be positive');
  }

  reserve(requestId: number, groupId: number, at = new Date()): Promise<PlatformBudgetReservationResult> {
    return this.repository.reserve({
      requestId,
      groupId,
      maxSubsidyCostTwd: this.maxSubsidyCostTwd,
      globalBudgetCostTwd: this.globalBudgetCostTwd,
      at,
    });
  }

  release(requestId: number, at = new Date()): Promise<void> {
    return this.repository.release(requestId, at);
  }
}
