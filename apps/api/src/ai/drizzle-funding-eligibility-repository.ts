import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { parseTwdCostUnits } from '../credits/allocation';
import type { AiFundingSnapshot, AiFundingSnapshotRepository } from './funding-eligibility';

type FundingRow = {
  welcome_available_cost_twd: string;
  ad_available_cost_twd: string;
  paid_available_cost_twd: string;
  global_free_ai_spent_cost_twd: string;
};

const GLOBAL_FREE_AI_BUDGET_KEY = 'V1_FREE_AI';

export class DrizzleAiFundingSnapshotRepository implements AiFundingSnapshotRepository {
  constructor(private readonly db: Database) {}

  async load(groupId: number): Promise<AiFundingSnapshot> {
    const result = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(available_cost_twd) FILTER (WHERE bucket = 'WELCOME'), 0)::text
          AS welcome_available_cost_twd,
        COALESCE(SUM(available_cost_twd) FILTER (WHERE bucket = 'AD'), 0)::text
          AS ad_available_cost_twd,
        COALESCE(SUM(available_cost_twd) FILTER (WHERE bucket = 'PAID'), 0)::text
          AS paid_available_cost_twd,
        COALESCE((
          SELECT spent_cost_twd
          FROM global_free_ai_budget_state
          WHERE budget_key = ${GLOBAL_FREE_AI_BUDGET_KEY}
          LIMIT 1
        ), 0)::text AS global_free_ai_spent_cost_twd
      FROM credit_accounts
      WHERE group_id = ${groupId}
    `);
    const row = result.rows[0] as FundingRow | undefined;
    if (!row) throw new Error('AI funding snapshot returned no row');
    return {
      welcomeAvailableUnits: parseTwdCostUnits(row.welcome_available_cost_twd),
      adAvailableUnits: parseTwdCostUnits(row.ad_available_cost_twd),
      paidAvailableUnits: parseTwdCostUnits(row.paid_available_cost_twd),
      globalFreeAiSpentUnits: parseTwdCostUnits(row.global_free_ai_spent_cost_twd),
    };
  }
}
