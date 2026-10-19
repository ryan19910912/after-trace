import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiTimeRangeSummaryRecord, AiTimeRangeSummaryRepository } from './ai-time-range-summary';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class DrizzleAiTimeRangeSummaryRepository implements AiTimeRangeSummaryRepository {
  constructor(private readonly db: Database) {}

  async summaryEnabled(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT COALESCE((capabilities ->> 'aiTimeRangeSummary')::boolean, TRUE) AS enabled
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO'
        AND plan_type = 'SUBSCRIPTION'
        AND price_twd = 99
      LIMIT 1
    `);
    return (result.rows[0] as { enabled?: unknown } | undefined)?.enabled !== false;
  }

  async runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT provider,
             model,
             input_usd_per_million::text AS input_usd_per_million,
             output_usd_per_million::text AS output_usd_per_million,
             audio_usd_per_million::text AS audio_usd_per_million,
             image_usd_per_million::text AS image_usd_per_million,
             usd_twd_rate::text AS usd_twd_rate
      FROM worklog_ai_runtime_config
      WHERE id = 1
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      provider: requiredText(row.provider, 'provider'),
      model: requiredText(row.model, 'model'),
      inputUsdPerMillion: nonNegativeFinite(row.input_usd_per_million, 'input price'),
      outputUsdPerMillion: positiveFinite(row.output_usd_per_million, 'output price'),
      audioUsdPerMillion: nullableNonNegativeFinite(row.audio_usd_per_million, 'audio price'),
      imageUsdPerMillion: nullableNonNegativeFinite(row.image_usd_per_million, 'image price'),
      usdTwdRate: nullableNonNegativeFinite(row.usd_twd_rate, 'USD/TWD rate'),
    };
  }

  async recordsForRange(input: { sourceId: number; from: Date; to: Date; limit: number }): Promise<AiTimeRangeSummaryRecord[]> {
    const result = await this.db.execute(sql`
      SELECT record.id::text AS id,
             record.input_type,
             record.title,
             record.raw_text,
             record.occurred_at,
             record.created_at
      FROM worklog_records AS record
      WHERE record.source_id = ${input.sourceId}
        AND record.status = 'ACTIVE'
        AND COALESCE(record.occurred_at, record.created_at) >= ${input.from}
        AND COALESCE(record.occurred_at, record.created_at) < ${input.to}
      ORDER BY COALESCE(record.occurred_at, record.created_at) ASC,
               record.id ASC
      LIMIT ${input.limit}
    `);
    return result.rows.map((raw) => recordView(raw as Record<string, unknown>));
  }
}

function recordView(raw: Record<string, unknown>): AiTimeRangeSummaryRecord {
  const inputType = String(raw.input_type ?? '');
  if (!['TEXT', 'AUDIO', 'IMAGE', 'FILE'].includes(inputType)) throw new Error('AI_SUMMARY_RECORD_TYPE_INVALID');
  return {
    id: positiveInteger(raw.id, 'record id'),
    inputType: inputType as AiTimeRangeSummaryRecord['inputType'],
    title: nullableText(raw.title),
    rawText: requiredText(raw.raw_text, 'raw text'),
    occurredAt: isoOrNull(raw.occurred_at),
    createdAt: iso(raw.created_at),
  };
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
}
function positiveInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function nonNegativeFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function positiveFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function nullableNonNegativeFinite(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : nonNegativeFinite(value, label);
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}
function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid timestamp');
  return parsed.toISOString();
}
function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}
