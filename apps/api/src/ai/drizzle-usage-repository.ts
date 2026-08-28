import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiUsageRepository, BillableAiUsage } from './usage';

export class DrizzleAiUsageRepository implements AiUsageRepository {
  constructor(private readonly db: Database) {}

  async record(usage: BillableAiUsage): Promise<'RECORDED' | 'ALREADY_RECORDED'> {
    const result = await this.db.execute(sql`
      INSERT INTO ai_usage_events (
        group_id,
        line_user_id,
        usage_type,
        provider,
        model,
        input_tokens,
        output_tokens,
        input_usd_per_million_tokens,
        output_usd_per_million_tokens,
        cost_usd,
        usd_twd_rate,
        cost_twd,
        charged_cost_twd,
        latency_ms,
        charge_operation_id,
        created_at
      )
      VALUES (
        ${usage.groupId},
        ${usage.lineUserId},
        ${usage.usageType},
        ${usage.provider},
        ${usage.model},
        ${usage.inputTokens},
        ${usage.outputTokens},
        CAST(${usage.inputUsdPerMillionTokens} AS numeric),
        CAST(${usage.outputUsdPerMillionTokens} AS numeric),
        CAST(${usage.costUsd} AS numeric),
        CAST(${usage.usdTwdRate} AS numeric),
        CAST(${usage.costTwd} AS numeric),
        CAST(${usage.chargedCostTwd} AS numeric),
        ${usage.latencyMs},
        ${usage.chargeOperationId},
        ${usage.createdAt}
      )
      ON CONFLICT (charge_operation_id) DO NOTHING
      RETURNING id
    `);
    return result.rows.length > 0 ? 'RECORDED' : 'ALREADY_RECORDED';
  }
}
