import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiTaskProposalRecord, AiTaskProposalRepository } from './ai-task-proposal';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class DrizzleAiTaskProposalRepository implements AiTaskProposalRepository {
  constructor(private readonly db: Database) {}

  async taskProposalEnabled(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT COALESCE((capabilities ->> 'aiTaskProposal')::boolean, TRUE) AS enabled
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO' AND plan_type = 'SUBSCRIPTION' AND price_twd = 99
      LIMIT 1
    `);
    return (result.rows[0] as { enabled?: unknown } | undefined)?.enabled !== false;
  }

  async runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT provider, model,
             input_usd_per_million::text AS input_usd_per_million,
             output_usd_per_million::text AS output_usd_per_million,
             audio_usd_per_million::text AS audio_usd_per_million,
             image_usd_per_million::text AS image_usd_per_million,
             usd_twd_rate::text AS usd_twd_rate
      FROM worklog_ai_runtime_config WHERE id = 1 LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      provider: text(row.provider, 'provider'), model: text(row.model, 'model'),
      inputUsdPerMillion: nonNegative(row.input_usd_per_million),
      outputUsdPerMillion: positive(row.output_usd_per_million),
      audioUsdPerMillion: nullableNonNegative(row.audio_usd_per_million),
      imageUsdPerMillion: nullableNonNegative(row.image_usd_per_million),
      usdTwdRate: nullableNonNegative(row.usd_twd_rate),
    };
  }

  async recordContext(sourceId: number, recordId: number): Promise<AiTaskProposalRecord | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, source_id::text AS source_id, title, raw_text, occurred_at
      FROM worklog_records
      WHERE id = ${recordId}
        AND source_id = ${sourceId}
        AND status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: integer(row.id), sourceId: integer(row.source_id),
      title: nullableText(row.title), rawText: text(row.raw_text, 'raw text'), occurredAt: isoOrNull(row.occurred_at),
    };
  }
}

function number(value: unknown) { return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; }
function integer(value: unknown) { const parsed = number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('AI_TASK_RECORD_INVALID'); return parsed; }
function nonNegative(value: unknown) { const parsed = number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error('AI_RUNTIME_CONFIG_INVALID'); return parsed; }
function positive(value: unknown) { const parsed = number(value); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AI_RUNTIME_CONFIG_INVALID'); return parsed; }
function nullableNonNegative(value: unknown) { return value === null || value === undefined ? null : nonNegative(value); }
function text(value: unknown, label: string) { if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`); return value.trim(); }
function nullableText(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function isoOrNull(value: unknown) { if (value === null || value === undefined) return null; const date = value instanceof Date ? value : new Date(String(value)); if (Number.isNaN(date.getTime())) throw new Error('AI_TASK_RECORD_INVALID'); return date.toISOString(); }
