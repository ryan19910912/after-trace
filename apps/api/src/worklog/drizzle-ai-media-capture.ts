import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AiMediaCaptureRepository, AiMediaInputType, AiMediaPlanLimits } from './ai-media-capture';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class DrizzleAiMediaCaptureRepository implements AiMediaCaptureRepository {
  constructor(private readonly db: Database) {}

  async mediaPlan(userId: number): Promise<AiMediaPlanLimits | null> {
    const result = await this.db.execute(sql`
      SELECT plan.enabled,
             plan.ai_enabled,
             COALESCE((plan.capabilities ->> 'aiMediaIngestion')::boolean, TRUE) AS media_enabled,
             COALESCE((plan.capabilities ->> 'maxImagesPerRequest')::integer, 1) AS max_images_per_request,
             COALESCE((plan.capabilities ->> 'maxImageBytes')::integer, 5242880) AS max_image_bytes,
             COALESCE((plan.capabilities ->> 'maxAudioSeconds')::integer, 300) AS max_audio_seconds,
             COALESCE((plan.capabilities ->> 'maxAudioBytes')::integer, 10485760) AS max_audio_bytes,
             COALESCE((plan.capabilities ->> 'maxFileBytes')::integer, 10485760) AS max_file_bytes
      FROM worklog_user_subscriptions AS subscription
      INNER JOIN worklog_subscription_plans AS plan ON plan.code = subscription.plan_code
      WHERE subscription.user_id = ${userId}
        AND subscription.status = 'ACTIVE'
        AND subscription.effective_at <= NOW()
        AND subscription.current_period_start <= NOW()
        AND (subscription.current_period_end IS NULL OR NOW() < subscription.current_period_end)
        AND plan.plan_type = 'SUBSCRIPTION'
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      enabled: Boolean(row.enabled && row.ai_enabled && row.media_enabled),
      maxImagesPerRequest: boundedPositiveInteger(row.max_images_per_request, 1, 10),
      maxImageBytes: boundedPositiveInteger(row.max_image_bytes, 1, 20 * 1024 * 1024),
      maxAudioSeconds: boundedPositiveInteger(row.max_audio_seconds, 1, 3600),
      maxAudioBytes: boundedPositiveInteger(row.max_audio_bytes, 1, 30 * 1024 * 1024),
      maxFileBytes: boundedPositiveInteger(row.max_file_bytes, 1, 30 * 1024 * 1024),
    };
  }

  async runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT provider, model,
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

  async createMediaRecord(input: Parameters<AiMediaCaptureRepository['createMediaRecord']>[0]) {
    const metadataJson = JSON.stringify(input.attachmentMetadata);
    const captureContextJson = input.captureContext ? JSON.stringify(input.captureContext) : null;
    const result = await this.db.execute(sql`
      INSERT INTO worklog_records (
        source_id, author_user_id, input_type, raw_text, title, search_terms,
        extracted_metadata, capture_context, ai_enrichment_status, ai_enriched_at,
        occurred_at, status, version, created_at, updated_at
      )
      SELECT source_row.id, ${input.userId}, ${input.inputType}, ${input.rawText}, NULL,
             '[]'::jsonb, ${metadataJson}::jsonb, ${captureContextJson}::jsonb,
             'ENRICHED', ${input.enrichedAt}, NULL, 'ACTIVE', 1, NOW(), NOW()
      FROM worklog_sources AS source_row
      WHERE source_row.id = ${input.sourceId} AND source_row.status = 'ACTIVE'
      RETURNING id::text AS id, source_id::text AS source_id,
                author_user_id::text AS author_user_id, input_type, raw_text,
                capture_context, created_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('AI_RECORD_CREATE_FAILED');

    const workspaceResult = await this.db.execute(sql`SELECT workspace_id::text AS workspace_id FROM worklog_sources WHERE id = ${input.sourceId} LIMIT 1`);
    const workspaceId = optionalPositiveInteger((workspaceResult.rows[0] as { workspace_id?: unknown } | undefined)?.workspace_id);
    return {
      workspaceId,
      record: {
        id: positiveInteger(row.id, 'record id'),
        sourceId: positiveInteger(row.source_id, 'source id'),
        authorUserId: positiveInteger(row.author_user_id, 'author user id'),
        inputType: inputType(row.input_type),
        rawText: requiredText(row.raw_text, 'raw text'),
        captureContext: captureContext(row.capture_context),
        createdAt: iso(row.created_at),
      },
    };
  }
}

function inputType(value: unknown): AiMediaInputType { if (value === 'IMAGE' || value === 'AUDIO' || value === 'FILE') return value; throw new Error('invalid media input type'); }
function captureContext(value: unknown) { if (!value || typeof value !== 'object' || Array.isArray(value)) return null; const context = value as Record<string, unknown>; if (context.client !== 'CHROME_EXTENSION' || !context.page || typeof context.page !== 'object' || Array.isArray(context.page)) return null; const page = context.page as Record<string, unknown>; const title = typeof page.title === 'string' && page.title.trim() ? page.title.trim() : null; const url = typeof page.url === 'string' && page.url.trim() ? page.url.trim() : null; return title || url ? { client: 'CHROME_EXTENSION' as const, page: { title, url } } : null; }
function numeric(value: unknown): number { return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; }
function positiveInteger(value: unknown, label: string): number { const parsed = numeric(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`); return parsed; }
function boundedPositiveInteger(value: unknown, min: number, max: number): number { const parsed = numeric(value); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error('invalid media plan limit'); return parsed; }
function optionalPositiveInteger(value: unknown): number | null { if (value === null || value === undefined) return null; return positiveInteger(value, 'workspace id'); }
function nonNegativeFinite(value: unknown, label: string): number { const parsed = numeric(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`); return parsed; }
function positiveFinite(value: unknown, label: string): number { const parsed = numeric(value); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}`); return parsed; }
function nullableNonNegativeFinite(value: unknown, label: string): number | null { if (value === null || value === undefined) return null; return nonNegativeFinite(value, label); }
function requiredText(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`); return value.trim(); }
function iso(value: unknown): string { const parsed = value instanceof Date ? value : new Date(String(value)); if (Number.isNaN(parsed.getTime())) throw new Error('invalid timestamp'); return parsed.toISOString(); }
