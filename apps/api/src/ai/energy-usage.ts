import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type EnergyAiUsage = {
  requestId: number;
  groupId: number;
  usageType: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  costTwd: string;
  energyUnits: bigint;
  latencyMs: number | null;
  createdAt: Date;
};

export interface EnergyAiUsageRepository {
  record(usage: EnergyAiUsage): Promise<'RECORDED' | 'ALREADY_RECORDED' | 'REFERENCE_CONFLICT'>;
}

export class DrizzleEnergyAiUsageRepository implements EnergyAiUsageRepository {
  constructor(private readonly db: Database) {}

  async record(usage: EnergyAiUsage): Promise<'RECORDED' | 'ALREADY_RECORDED' | 'REFERENCE_CONFLICT'> {
    const result = await this.db.execute(sql`
      WITH existing AS (
        SELECT * FROM ai_energy_usage_events WHERE request_id = ${usage.requestId}
      ), inserted AS (
        INSERT INTO ai_energy_usage_events (
          request_id, group_id, usage_type, provider, model,
          input_tokens, output_tokens, cost_usd, cost_twd,
          energy_units, latency_ms, created_at
        )
        SELECT
          ${usage.requestId}, ${usage.groupId}, ${usage.usageType}, ${usage.provider}, ${usage.model},
          ${usage.inputTokens}, ${usage.outputTokens}, CAST(${usage.costUsd} AS numeric),
          CAST(${usage.costTwd} AS numeric), ${usage.energyUnits.toString()}::bigint,
          ${usage.latencyMs}, ${usage.createdAt}
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM existing
          WHERE group_id <> ${usage.groupId}
             OR usage_type <> ${usage.usageType}
             OR provider <> ${usage.provider}
             OR model <> ${usage.model}
             OR input_tokens <> ${usage.inputTokens}
             OR output_tokens <> ${usage.outputTokens}
             OR cost_usd <> CAST(${usage.costUsd} AS numeric)
             OR cost_twd <> CAST(${usage.costTwd} AS numeric)
             OR energy_units <> ${usage.energyUnits.toString()}::bigint
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_RECORDED'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'RECORDED'
        ELSE 'ALREADY_RECORDED'
      END AS status
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    if (status === 'RECORDED' || status === 'ALREADY_RECORDED' || status === 'REFERENCE_CONFLICT') {
      return status;
    }
    throw new Error('Energy AI usage persistence returned invalid status');
  }
}
