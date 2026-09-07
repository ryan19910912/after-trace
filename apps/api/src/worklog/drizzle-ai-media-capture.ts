import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiMediaCaptureRepository } from './ai-media-capture';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class DrizzleAiMediaCaptureRepository implements AiMediaCaptureRepository {
  constructor(private readonly db: Database) {}

  async mediaEnabled(): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT enabled,
             ai_enabled,
             COALESCE((capabilities ->> 'aiMediaIngestion')::boolean, TRUE) AS media_enabled
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO'
        AND plan_type = 'SUBSCRIPTION'
        AND price_twd = 99
      LIMIT 1
    `);
    const row = result.rows[0] as { enabled?: boolean; ai_enabled?: boolean; media_enabled?: boolean } | undefined;
    return Boolean(row?.enabled && row.ai_enabled && row.media_enabled);
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

  async createImageRecord(input: Parameters<AiMediaCaptureRepository['createImageRecord']>[0]) {
    const metadataJson = JSON.stringify(input.attachmentMetadata);
    const captureContextJson = input.captureContext ? JSON.stringify(input.captureContext) : null;
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
        capture_context,
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
             'IMAGE',
             ${input.rawText},
             NULL,
             '[]'::jsonb,
             ${metadataJson}::jsonb,
             ${captureContextJson}::jsonb,
             'ENRICHED',
             ${input.enrichedAt},
             NULL,
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
                input_type,
                raw_text,
                capture_context,
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
        inputType: 'IMAGE' as const,
        rawText: requiredText(row.raw_text, 'raw text'),
        captureContext: captureContext(row.capture_context),
        createdAt: iso(row.created_at),
      },
    };
  }
}

function captureContext(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  if (context.client !== 'CHROME_EXTENSION' || !context.page || typeof context.page !== 'object' || Array.isArray(context.page)) return null;
  const page = context.page as Record<string, unknown>;
  const title = typeof page.title === 'string' && page.title.trim() ? page.title.trim() : null;
  const url = typeof page.url === 'string' && page.url.trim() ? page.url.trim() : null;
  return title || url ? { client: 'CHROME_EXTENSION' as const, page: { title, url } } : null;
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
function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid timestamp');
  return parsed.toISOString();
}
