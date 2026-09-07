import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiRelatedRecord, AiRelatedRecordsRepository } from './ai-related-records';

export class DrizzleAiRelatedRecordsRepository implements AiRelatedRecordsRepository {
  constructor(private readonly db: Database) {}

  async relatedEnabled(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT enabled,
             ai_enabled,
             COALESCE((capabilities ->> 'aiRelatedRecords')::boolean, TRUE) AS related_enabled
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO'
        AND plan_type = 'SUBSCRIPTION'
        AND price_twd = 99
      LIMIT 1
    `);
    const row = result.rows[0] as { enabled?: boolean; ai_enabled?: boolean; related_enabled?: boolean } | undefined;
    return Boolean(row?.enabled && row.ai_enabled && row.related_enabled);
  }

  async findRelated(input: {
    sourceId: number;
    recordId: number;
    limit: number;
  }): Promise<{ targetFound: boolean; records: AiRelatedRecord[] }> {
    const targetResult = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM worklog_records AS record_row
        WHERE record_row.id = ${input.recordId}
          AND record_row.source_id = ${input.sourceId}
          AND record_row.status = 'ACTIVE'
      ) AS target_found
    `);
    const targetFound = Boolean((targetResult.rows[0] as { target_found?: unknown } | undefined)?.target_found);
    if (!targetFound) return { targetFound: false, records: [] };

    const result = await this.db.execute(sql`
      WITH target_record AS MATERIALIZED (
        SELECT record_row.id,
               record_row.source_id,
               record_row.title,
               record_row.raw_text,
               record_row.search_terms,
               record_row.extracted_metadata,
               COALESCE(record_row.occurred_at, record_row.created_at) AS event_at
        FROM worklog_records AS record_row
        WHERE record_row.id = ${input.recordId}
          AND record_row.source_id = ${input.sourceId}
          AND record_row.status = 'ACTIVE'
        LIMIT 1
      ),
      target_terms AS (
        SELECT DISTINCT lower(btrim(term_item.term)) AS term
        FROM target_record AS target_row
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(target_row.search_terms, '[]'::jsonb)) AS term_item(term)
        WHERE length(btrim(term_item.term)) BETWEEN 2 AND 100
        UNION
        SELECT lower(btrim(target_row.title)) AS term
        FROM target_record AS target_row
        WHERE target_row.title IS NOT NULL
          AND length(btrim(target_row.title)) BETWEEN 2 AND 100
      ),
      target_metadata AS (
        SELECT metadata_item.key,
               metadata_item.value
        FROM target_record AS target_row
        CROSS JOIN LATERAL jsonb_each(COALESCE(target_row.extracted_metadata, '{}'::jsonb)) AS metadata_item(key, value)
        WHERE jsonb_typeof(metadata_item.value) IN ('string', 'number', 'boolean')
      ),
      scored_records AS (
        SELECT candidate_row.id,
               candidate_row.source_id,
               candidate_row.input_type,
               candidate_row.title,
               candidate_row.raw_text,
               candidate_row.occurred_at,
               candidate_row.created_at,
               (
                 CASE
                   WHEN target_row.title IS NOT NULL
                    AND candidate_row.title IS NOT NULL
                    AND lower(btrim(candidate_row.title)) = lower(btrim(target_row.title))
                   THEN 8 ELSE 0
                 END
                 + 4 * (
                   SELECT COUNT(*)::integer
                   FROM target_terms AS term_row
                   WHERE candidate_row.raw_text ILIKE '%' || term_row.term || '%'
                      OR COALESCE(candidate_row.title, '') ILIKE '%' || term_row.term || '%'
                      OR COALESCE(candidate_row.search_terms::text, '') ILIKE '%' || term_row.term || '%'
                      OR COALESCE(candidate_row.extracted_metadata::text, '') ILIKE '%' || term_row.term || '%'
                 )
                 + 3 * (
                   SELECT COUNT(*)::integer
                   FROM target_metadata AS metadata_row
                   WHERE candidate_row.extracted_metadata -> metadata_row.key = metadata_row.value
                 )
                 + CASE
                     WHEN lower(btrim(candidate_row.raw_text)) = lower(btrim(target_row.raw_text)) THEN 2
                     ELSE 0
                   END
               )::integer AS relevance_score,
               ABS(EXTRACT(EPOCH FROM (
                 COALESCE(candidate_row.occurred_at, candidate_row.created_at) - target_row.event_at
               ))) AS time_distance_seconds
        FROM worklog_records AS candidate_row
        CROSS JOIN target_record AS target_row
        WHERE candidate_row.source_id = target_row.source_id
          AND candidate_row.id <> target_row.id
          AND candidate_row.status = 'ACTIVE'
      )
      SELECT scored_row.id::text AS id,
             scored_row.source_id::text AS source_id,
             scored_row.input_type,
             scored_row.title,
             scored_row.raw_text,
             scored_row.occurred_at,
             scored_row.created_at,
             scored_row.relevance_score
      FROM scored_records AS scored_row
      WHERE scored_row.relevance_score > 0
      ORDER BY scored_row.relevance_score DESC,
               scored_row.time_distance_seconds ASC,
               COALESCE(scored_row.occurred_at, scored_row.created_at) DESC,
               scored_row.id DESC
      LIMIT ${input.limit}
    `);

    return {
      targetFound: true,
      records: (result.rows as Array<Record<string, unknown>>).map(recordView),
    };
  }
}

function recordView(row: Record<string, unknown>): AiRelatedRecord {
  return {
    id: positiveInteger(row.id, 'record id'),
    sourceId: positiveInteger(row.source_id, 'source id'),
    inputType: recordInputType(row.input_type),
    title: nullableText(row.title),
    rawText: requiredText(row.raw_text, 'raw text'),
    occurredAt: nullableIso(row.occurred_at),
    createdAt: iso(row.created_at),
    relevanceScore: positiveInteger(row.relevance_score, 'relevance score'),
  };
}

function recordInputType(value: unknown): AiRelatedRecord['inputType'] {
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
