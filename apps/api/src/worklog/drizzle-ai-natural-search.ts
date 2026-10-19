import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  AiNaturalSearchRecord,
  AiNaturalSearchRepository,
} from './ai-natural-search';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class DrizzleAiNaturalSearchRepository implements AiNaturalSearchRepository {
  constructor(private readonly db: Database) {}

  async searchEnabled(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT enabled,
             ai_enabled,
             COALESCE((capabilities ->> 'aiNaturalSearch')::boolean, TRUE) AS search_enabled
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO'
        AND plan_type = 'SUBSCRIPTION'
        AND price_twd = 99
      LIMIT 1
    `);
    const row = result.rows[0] as { enabled?: boolean; ai_enabled?: boolean; search_enabled?: boolean } | undefined;
    return Boolean(row?.enabled && row.ai_enabled && row.search_enabled);
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

  async searchRecords(input: {
    sourceId: number;
    terms: string[];
    from: Date | null;
    to: Date | null;
    limit: number;
  }): Promise<AiNaturalSearchRecord[]> {
    const termsJson = JSON.stringify(input.terms);
    const result = await this.db.execute(sql`
      WITH requested_terms AS (
        SELECT term_value.term
        FROM jsonb_array_elements_text(${termsJson}::jsonb) AS term_value(term)
      ), ranked_records AS (
        SELECT record.id,
               record.source_id,
               record.input_type,
               record.title,
               record.raw_text,
               record.occurred_at,
               record.created_at,
               (
                 SELECT COUNT(*)::integer
                 FROM requested_terms requested_term
                 WHERE record.raw_text ILIKE '%' || requested_term.term || '%'
                    OR COALESCE(record.title, '') ILIKE '%' || requested_term.term || '%'
                    OR COALESCE(record.search_terms::text, '') ILIKE '%' || requested_term.term || '%'
                    OR COALESCE(record.extracted_metadata::text, '') ILIKE '%' || requested_term.term || '%'
               ) AS term_score
        FROM worklog_records record
        WHERE record.source_id = ${input.sourceId}
          AND record.status = 'ACTIVE'
          AND (
            ${input.from}::timestamptz IS NULL
            OR COALESCE(record.occurred_at, record.created_at) >= ${input.from}
          )
          AND (
            ${input.to}::timestamptz IS NULL
            OR COALESCE(record.occurred_at, record.created_at) < ${input.to}
          )
      )
      SELECT ranked_record.id::text AS id,
             ranked_record.source_id::text AS source_id,
             ranked_record.input_type,
             ranked_record.title,
             ranked_record.raw_text,
             ranked_record.occurred_at,
             ranked_record.created_at
      FROM ranked_records ranked_record
      WHERE jsonb_array_length(${termsJson}::jsonb) = 0
         OR ranked_record.term_score > 0
      ORDER BY ranked_record.term_score DESC,
               COALESCE(ranked_record.occurred_at, ranked_record.created_at) DESC,
               ranked_record.id DESC
      LIMIT ${input.limit}
    `);
    return (result.rows as Array<Record<string, unknown>>).map(recordView);
  }
}

function recordView(row: Record<string, unknown>): AiNaturalSearchRecord {
  return {
    id: positiveInteger(row.id, 'record id'),
    sourceId: positiveInteger(row.source_id, 'source id'),
    inputType: recordInputType(row.input_type),
    title: nullableText(row.title),
    rawText: requiredText(row.raw_text, 'raw text'),
    occurredAt: nullableIso(row.occurred_at),
    createdAt: iso(row.created_at),
  };
}
function recordInputType(value: unknown): AiNaturalSearchRecord['inputType'] {
  if (value === 'TEXT' || value === 'AUDIO' || value === 'IMAGE' || value === 'FILE') return value;
  throw new Error('invalid record input type');
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
  if (value === null || value === undefined) return null;
  return nonNegativeFinite(value, label);
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}
function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}
function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid timestamp');
  return parsed.toISOString();
}
