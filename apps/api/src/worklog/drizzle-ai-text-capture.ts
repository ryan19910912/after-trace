import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiTextCaptureRepository } from './ai-text-capture';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class DrizzleAiTextCaptureRepository implements AiTextCaptureRepository {
  constructor(private readonly db: Database) {}

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

  async createAiRecord(input: Parameters<AiTextCaptureRepository['createAiRecord']>[0]) {
    const occurredAt = input.output.occurredAt ? new Date(input.output.occurredAt) : null;
    if (occurredAt && Number.isNaN(occurredAt.getTime())) throw new Error('AI_CAPTURE_OCCURRED_AT_INVALID');
    const terms = JSON.stringify(input.output.searchTerms);
    const result = await this.db.execute(sql`
      INSERT INTO worklog_records (
        source_id,
        entity_id,
        author_user_id,
        input_type,
        raw_text,
        title,
        search_terms,
        extracted_metadata,
        ai_enrichment_status,
        ai_enriched_at,
        occurred_at,
        status,
        version,
        created_at,
        updated_at
      )
      SELECT source_row.id,
             NULL,
             ${input.userId},
             'TEXT',
             ${input.rawText},
             ${input.output.title},
             ${terms}::jsonb,
             NULL,
             'ENRICHED',
             ${input.enrichedAt},
             ${occurredAt},
             'ACTIVE',
             1,
             NOW(),
             NOW()
      FROM worklog_sources AS source_row
      WHERE source_row.id = ${input.sourceId}
        AND source_row.status = 'ACTIVE'
      RETURNING id::text AS id,
                source_id::text AS source_id,
                author_user_id::text AS author_user_id,
                raw_text,
                title,
                search_terms,
                occurred_at,
                created_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('AI_RECORD_CREATE_FAILED');

    const workspaceResult = await this.db.execute(sql`
      SELECT workspace_id::text AS workspace_id
      FROM worklog_sources
      WHERE id = ${input.sourceId}
      LIMIT 1
    `);
    const workspaceId = optionalPositiveInteger(
      (workspaceResult.rows[0] as { workspace_id?: unknown } | undefined)?.workspace_id,
    );

    return {
      workspaceId,
      record: {
        id: positiveInteger(row.id, 'record id'),
        sourceId: positiveInteger(row.source_id, 'source id'),
        authorUserId: positiveInteger(row.author_user_id, 'author user id'),
        rawText: requiredText(row.raw_text, 'raw text'),
        title: nullableText(row.title),
        searchTerms: stringArray(row.search_terms),
        occurredAt: iso(row.occurred_at),
        createdAt: iso(row.created_at) ?? input.enrichedAt.toISOString(),
      },
    };
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
}
function positiveInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function optionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return positiveInteger(value, 'workspace id');
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
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid timestamp');
  return parsed.toISOString();
}
