import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAttachmentClaimState,
  WorklogAttachmentOutput,
  WorklogAttachmentRepository,
} from './attachment-ingestion';
import type { WorklogAiUsageCommit } from './subscription';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

type StateRow = {
  quoted_line_message_id: string;
  source_id: string | number;
  actor_user_id: string | number;
  status: string;
  reservation_token: string | null;
  record_id: string | number | null;
  usage_commit_json: unknown;
  last_error_code: string | null;
};

type ConfigRow = {
  provider: string;
  model: string;
  input_usd_per_million: string | number;
  output_usd_per_million: string | number;
  audio_usd_per_million: string | number | null;
  image_usd_per_million: string | number | null;
  usd_twd_rate: string | number | null;
};

export class DrizzleWorklogAttachmentRepository implements WorklogAttachmentRepository {
  constructor(private readonly db: Database) {}

  async claim(input: {
    sourceId: number;
    actorUserId: number;
    commandLineMessageId: string;
    quotedLineMessageId: string;
  }): Promise<WorklogAttachmentClaimState> {
    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_attachment_ingestions (
        command_line_message_id, quoted_line_message_id, source_id, actor_user_id,
        status, created_at, updated_at
      ) VALUES (
        ${input.commandLineMessageId}, ${input.quotedLineMessageId}, ${input.sourceId},
        ${input.actorUserId}, 'PROCESSING', NOW(), NOW()
      )
      ON CONFLICT (command_line_message_id) DO NOTHING
      RETURNING command_line_message_id
    `);
    if (inserted.rows.length > 0) return { status: 'CLAIMED' };

    // Never auto-replay an uncertain provider attempt. If a Worker died while the
    // provider call may have been in flight, terminalize it and require an explicit
    // future/admin retry instead of risking duplicate AI cost.
    await this.db.execute(sql`
      UPDATE worklog_attachment_ingestions
      SET status = 'FAILED',
          last_error_code = 'ATTACHMENT_PROCESSING_STALE_UNCERTAIN',
          updated_at = NOW()
      WHERE command_line_message_id = ${input.commandLineMessageId}
        AND status = 'PROCESSING'
        AND updated_at < NOW() - INTERVAL '15 minutes'
    `);

    const row = await this.load(input.commandLineMessageId);
    if (!row) return { status: 'FAILED', reason: 'INGESTION_STATE_MISSING' };
    if (
      Number(row.source_id) !== input.sourceId ||
      Number(row.actor_user_id) !== input.actorUserId ||
      row.quoted_line_message_id !== input.quotedLineMessageId
    ) return { status: 'FAILED', reason: 'IDEMPOTENCY_CONFLICT' };

    if (row.status === 'PROCESSING') return { status: 'PROCESSING' };
    if (row.status === 'SUCCEEDED' && row.record_id != null) {
      return { status: 'SUCCEEDED', recordId: positiveNumber(row.record_id, 'record_id') };
    }
    if (row.status === 'RECORD_CREATED' && row.record_id != null && row.reservation_token) {
      return {
        status: 'RECORD_CREATED',
        recordId: positiveNumber(row.record_id, 'record_id'),
        reservationToken: row.reservation_token,
        usage: parseUsage(row.usage_commit_json),
      };
    }
    return { status: 'FAILED', reason: row.last_error_code || 'ATTACHMENT_INGESTION_FAILED' };
  }

  async getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT provider, model, input_usd_per_million, output_usd_per_million,
             audio_usd_per_million, image_usd_per_million, usd_twd_rate
      FROM worklog_ai_runtime_config WHERE id = 1 LIMIT 1
    `);
    const row = result.rows[0] as ConfigRow | undefined;
    if (!row) return null;
    return {
      provider: requiredText(row.provider, 'provider'),
      model: requiredText(row.model, 'model'),
      inputUsdPerMillion: nonNegative(row.input_usd_per_million, 'input_usd_per_million'),
      outputUsdPerMillion: nonNegative(row.output_usd_per_million, 'output_usd_per_million'),
      audioUsdPerMillion: nullableNonNegative(row.audio_usd_per_million, 'audio_usd_per_million'),
      imageUsdPerMillion: nullableNonNegative(row.image_usd_per_million, 'image_usd_per_million'),
      usdTwdRate: nullableNonNegative(row.usd_twd_rate, 'usd_twd_rate'),
    };
  }

  async insertRecord(input: {
    sourceId: number;
    actorUserId: number;
    commandLineMessageId: string;
    quotedLineMessageId: string;
    sourceTimestamp: Date;
    output: WorklogAttachmentOutput;
  }): Promise<{ status: 'CREATED' | 'EXISTING'; recordId: number } | { status: 'SOURCE_NOT_FOUND' }> {
    const metadata = JSON.stringify(input.output.attachmentMetadata);
    const result = await this.db.execute(sql`
      WITH active_source AS (
        SELECT id, workspace_id FROM worklog_sources
        WHERE id = ${input.sourceId} AND status = 'ACTIVE' LIMIT 1
      ), inserted AS (
        INSERT INTO worklog_records (
          workspace_id, source_id, author_user_id, line_message_id,
          quoted_line_message_id, input_type, category, raw_text,
          attachment_metadata, normalized_summary, source_timestamp,
          created_at, updated_at
        )
        SELECT workspace_id, id, ${input.actorUserId}, ${input.commandLineMessageId},
               ${input.quotedLineMessageId}, ${input.output.inputType}, ${input.output.category},
               ${input.output.rawText}, ${metadata}::jsonb, ${input.output.summary},
               ${input.sourceTimestamp}, NOW(), NOW()
        FROM active_source
        ON CONFLICT (line_message_id) DO NOTHING
        RETURNING id
      )
      SELECT id::text AS id, TRUE AS inserted FROM inserted
      UNION ALL
      SELECT existing.id::text AS id, FALSE AS inserted
      FROM worklog_records existing
      WHERE existing.line_message_id = ${input.commandLineMessageId}
        AND existing.source_id = ${input.sourceId}
        AND existing.author_user_id = ${input.actorUserId}
        AND existing.quoted_line_message_id = ${input.quotedLineMessageId}
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; inserted?: boolean } | undefined;
    if (!row?.id) return { status: 'SOURCE_NOT_FOUND' };
    return { status: row.inserted ? 'CREATED' : 'EXISTING', recordId: Number(row.id) };
  }

  async saveRecordCreated(input: {
    commandLineMessageId: string;
    recordId: number;
    reservationToken: string;
    usage: WorklogAiUsageCommit;
  }): Promise<void> {
    const usageJson = JSON.stringify(input.usage);
    const result = await this.db.execute(sql`
      UPDATE worklog_attachment_ingestions
      SET status = 'RECORD_CREATED', record_id = ${input.recordId},
          reservation_token = ${input.reservationToken}, usage_commit_json = ${usageJson}::jsonb,
          last_error_code = NULL, updated_at = NOW()
      WHERE command_line_message_id = ${input.commandLineMessageId}
        AND status = 'PROCESSING'
      RETURNING id
    `);
    if (result.rows.length < 1) throw new Error('ATTACHMENT_STATE_ADVANCE_FAILED');
  }

  async reservationStatus(token: string) {
    const result = await this.db.execute(sql`SELECT status FROM worklog_ai_quota_reservations WHERE token = ${token} LIMIT 1`);
    const value = (result.rows[0] as { status?: string } | undefined)?.status;
    return value === 'RESERVED' || value === 'COMMITTED' || value === 'RELEASED' || value === 'EXPIRED' ? value : null;
  }

  async markSucceeded(commandLineMessageId: string, recordId: number): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_attachment_ingestions
      SET status = 'SUCCEEDED', completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW(), last_error_code = NULL
      WHERE command_line_message_id = ${commandLineMessageId}
        AND record_id = ${recordId}
        AND status IN ('RECORD_CREATED', 'SUCCEEDED')
      RETURNING id
    `);
    if (result.rows.length < 1) throw new Error('ATTACHMENT_STATE_COMPLETE_FAILED');
  }

  async fail(commandLineMessageId: string, reason: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_attachment_ingestions
      SET status = 'FAILED', last_error_code = ${reason.slice(0, 128)}, updated_at = NOW()
      WHERE command_line_message_id = ${commandLineMessageId} AND status <> 'SUCCEEDED'
    `);
  }

  private async load(commandLineMessageId: string): Promise<StateRow | null> {
    const result = await this.db.execute(sql`
      SELECT quoted_line_message_id, source_id::text AS source_id,
             actor_user_id::text AS actor_user_id, status, reservation_token,
             record_id::text AS record_id, usage_commit_json, last_error_code
      FROM worklog_attachment_ingestions
      WHERE command_line_message_id = ${commandLineMessageId} LIMIT 1
    `);
    return (result.rows[0] as StateRow | undefined) ?? null;
  }
}

function parseUsage(value: unknown): WorklogAiUsageCommit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ATTACHMENT_USAGE_STATE_INVALID');
  const row = value as Record<string, unknown>;
  return {
    actualUnits: integer(row.actualUnits, 'actualUnits'), workspaceId: optionalInteger(row.workspaceId), recordId: optionalInteger(row.recordId),
    provider: requiredUnknownText(row.provider, 'provider'), model: requiredUnknownText(row.model, 'model'),
    inputTokens: integer(row.inputTokens, 'inputTokens'), outputTokens: integer(row.outputTokens, 'outputTokens'),
    audioInputUnits: integer(row.audioInputUnits ?? 0, 'audioInputUnits'), imageInputUnits: integer(row.imageInputUnits ?? 0, 'imageInputUnits'),
    inputUsdPerMillion: numberValue(row.inputUsdPerMillion, 'inputUsdPerMillion'), outputUsdPerMillion: numberValue(row.outputUsdPerMillion, 'outputUsdPerMillion'),
    audioUsdPerMillion: optionalNumber(row.audioUsdPerMillion), imageUsdPerMillion: optionalNumber(row.imageUsdPerMillion), usdTwdRate: optionalNumber(row.usdTwdRate),
    providerCostUsd: numberValue(row.providerCostUsd, 'providerCostUsd'), providerCostTwd: optionalNumber(row.providerCostTwd),
  };
}

function positiveNumber(value: string | number, label: string) { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`invalid ${label}`); return n; }
function requiredText(value: string, label: string) { const v = value.trim(); if (!v) throw new Error(`invalid ${label}`); return v; }
function requiredUnknownText(value: unknown, label: string) { if (typeof value !== 'string') throw new Error(`invalid ${label}`); return requiredText(value, label); }
function nonNegative(value: string | number, label: string) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error(`invalid ${label}`); return n; }
function nullableNonNegative(value: string | number | null, label: string) { return value == null ? null : nonNegative(value, label); }
function integer(value: unknown, label: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${label}`); return value; }
function optionalInteger(value: unknown) { return value == null ? null : integer(value, 'integer'); }
function numberValue(value: unknown, label: string) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`invalid ${label}`); return value; }
function optionalNumber(value: unknown) { return value == null ? null : numberValue(value, 'number'); }
