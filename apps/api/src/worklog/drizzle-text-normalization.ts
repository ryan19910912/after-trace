import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogAiUsageCommit } from './subscription';
import {
  normalizeWorklogTextOutput,
  type WorklogAiRuntimeConfigSnapshot,
  type WorklogPersistedNormalizationPayload,
  type WorklogTextNormalizationBeginResult,
  type WorklogTextNormalizationContext,
  type WorklogTextNormalizationOutput,
  type WorklogTextNormalizationRepository,
} from './text-normalization';

type NormalizationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROVIDER_SUCCEEDED'
  | 'USAGE_COMMITTED'
  | 'SUCCEEDED'
  | 'FAILED';

type NormalizationStateRow = {
  record_id: string | number;
  status: NormalizationStatus;
  claim_token: string;
  reservation_token: string | null;
  result_json: unknown;
  usage_commit_json: unknown;
};

type ContextRow = {
  record_id: string | number;
  workspace_id: string | number;
  source_id: string | number;
  actor_user_id: string | number;
  charged_user_id: string | number;
  raw_text: string;
};

type RuntimeConfigRow = {
  provider: string;
  model: string;
  input_usd_per_million: string | number;
  output_usd_per_million: string | number;
  audio_usd_per_million: string | number | null;
  image_usd_per_million: string | number | null;
  usd_twd_rate: string | number | null;
};

export class DrizzleWorklogTextNormalizationRepository implements WorklogTextNormalizationRepository {
  constructor(private readonly db: Database) {}

  async begin(recordId: number, claimToken: string): Promise<WorklogTextNormalizationBeginResult> {
    const current = await this.loadState(recordId);
    if (current) {
      if (current.status === 'PENDING') {
        const claimed = await this.db.execute(sql`
          UPDATE worklog_record_ai_normalizations
          SET
            status = 'PROCESSING',
            claim_token = ${claimToken},
            reservation_token = NULL,
            result_json = NULL,
            usage_commit_json = NULL,
            provider_response_id = NULL,
            latency_ms = NULL,
            last_error_code = NULL,
            last_error_detail = NULL,
            started_at = NOW(),
            provider_succeeded_at = NULL,
            usage_committed_at = NULL,
            completed_at = NULL,
            updated_at = NOW()
          WHERE record_id = ${recordId}
            AND status = 'PENDING'
          RETURNING record_id
        `);
        if (claimed.rows.length > 0) {
          const context = await this.loadContext(recordId);
          if (!context) {
            await this.db.execute(sql`
              UPDATE worklog_record_ai_normalizations
              SET status = 'FAILED', last_error_code = 'RECORD_NOT_ELIGIBLE', updated_at = NOW()
              WHERE record_id = ${recordId}
                AND claim_token = ${claimToken}
                AND status = 'PROCESSING'
            `);
            return { status: 'NOT_ELIGIBLE' };
          }
          return { status: 'CLAIMED', context, claimToken };
        }
        const winner = await this.loadState(recordId);
        return winner ? stateResult(winner) : { status: 'NOT_ELIGIBLE' };
      }
      return stateResult(current);
    }

    const context = await this.loadContext(recordId);
    if (!context) return { status: 'NOT_ELIGIBLE' };

    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_record_ai_normalizations (
        record_id,
        status,
        claim_token,
        started_at,
        created_at,
        updated_at
      )
      VALUES (
        ${recordId},
        'PROCESSING',
        ${claimToken},
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (record_id) DO NOTHING
      RETURNING record_id
    `);
    if (inserted.rows.length > 0) return { status: 'CLAIMED', context, claimToken };

    const winner = await this.loadState(recordId);
    return winner ? stateResult(winner) : { status: 'NOT_ELIGIBLE' };
  }

  async getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        provider,
        model,
        input_usd_per_million,
        output_usd_per_million,
        audio_usd_per_million,
        image_usd_per_million,
        usd_twd_rate
      FROM worklog_ai_runtime_config
      WHERE id = 1
      LIMIT 1
    `);
    const row = result.rows[0] as RuntimeConfigRow | undefined;
    if (!row) return null;
    return {
      provider: requiredDbText(row.provider, 'provider'),
      model: requiredDbText(row.model, 'model'),
      inputUsdPerMillion: nonNegativeNumeric(row.input_usd_per_million, 'input_usd_per_million'),
      outputUsdPerMillion: nonNegativeNumeric(row.output_usd_per_million, 'output_usd_per_million'),
      audioUsdPerMillion: nullableNonNegativeNumeric(row.audio_usd_per_million, 'audio_usd_per_million'),
      imageUsdPerMillion: nullableNonNegativeNumeric(row.image_usd_per_million, 'image_usd_per_million'),
      usdTwdRate: nullableNonNegativeNumeric(row.usd_twd_rate, 'usd_twd_rate'),
    };
  }

  async setPending(
    recordId: number,
    claimToken: string,
    errorCode: string,
    detail?: string | null,
  ): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'PENDING',
        reservation_token = NULL,
        last_error_code = ${trimTo(errorCode, 128)},
        last_error_detail = ${nullableTrimTo(detail, 2000)},
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status = 'PROCESSING'
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'normalization claim could not be deferred');
  }

  async saveProviderResult(input: {
    recordId: number;
    claimToken: string;
    reservationToken: string;
    output: WorklogTextNormalizationOutput;
    usage: WorklogAiUsageCommit;
    providerResponseId: string | null;
    latencyMs: number;
  }): Promise<void> {
    const resultJson = JSON.stringify(input.output);
    const usageJson = JSON.stringify(input.usage);
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'PROVIDER_SUCCEEDED',
        reservation_token = ${input.reservationToken},
        result_json = ${resultJson}::jsonb,
        usage_commit_json = ${usageJson}::jsonb,
        provider_response_id = ${input.providerResponseId},
        latency_ms = ${input.latencyMs},
        provider_succeeded_at = NOW(),
        last_error_code = NULL,
        last_error_detail = NULL,
        updated_at = NOW()
      WHERE record_id = ${input.recordId}
        AND claim_token = ${input.claimToken}
        AND status = 'PROCESSING'
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'provider result could not be persisted');
  }

  async getReservationStatus(
    reservationToken: string,
  ): Promise<'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null> {
    const result = await this.db.execute(sql`
      SELECT status
      FROM worklog_ai_quota_reservations
      WHERE token = ${reservationToken}
      LIMIT 1
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    return status === 'RESERVED' || status === 'COMMITTED' || status === 'RELEASED' || status === 'EXPIRED'
      ? status
      : null;
  }

  async markUsageCommitted(recordId: number, claimToken: string): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'USAGE_COMMITTED',
        usage_committed_at = COALESCE(usage_committed_at, NOW()),
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status IN ('PROVIDER_SUCCEEDED', 'USAGE_COMMITTED')
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'normalization usage state could not be committed');
  }

  async applyResult(input: {
    recordId: number;
    claimToken: string;
    output: WorklogTextNormalizationOutput;
  }): Promise<void> {
    const result = await this.db.execute(sql`
      WITH updated_record AS (
        UPDATE worklog_records
        SET
          normalized_summary = ${input.output.summary},
          category = ${input.output.category},
          updated_at = NOW()
        WHERE id = ${input.recordId}
        RETURNING id
      ), completed AS (
        UPDATE worklog_record_ai_normalizations
        SET
          status = 'SUCCEEDED',
          completed_at = COALESCE(completed_at, NOW()),
          last_error_code = NULL,
          last_error_detail = NULL,
          updated_at = NOW()
        WHERE record_id = ${input.recordId}
          AND claim_token = ${input.claimToken}
          AND status = 'USAGE_COMMITTED'
          AND EXISTS (SELECT 1 FROM updated_record)
        RETURNING record_id
      )
      SELECT record_id FROM completed
    `);
    requireMutation(result.rows.length, 'normalized record could not be applied');
  }

  async fail(
    recordId: number,
    claimToken: string,
    errorCode: string,
    detail?: string | null,
  ): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'FAILED',
        last_error_code = ${trimTo(errorCode, 128)},
        last_error_detail = ${nullableTrimTo(detail, 2000)},
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status IN ('PROCESSING', 'PROVIDER_SUCCEEDED')
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'normalization failure state could not be persisted');
  }

  private async loadState(recordId: number): Promise<NormalizationStateRow | null> {
    const result = await this.db.execute(sql`
      SELECT
        record_id::text AS record_id,
        status,
        claim_token,
        reservation_token,
        result_json,
        usage_commit_json
      FROM worklog_record_ai_normalizations
      WHERE record_id = ${recordId}
      LIMIT 1
    `);
    return (result.rows[0] as NormalizationStateRow | undefined) ?? null;
  }

  private async loadContext(recordId: number): Promise<WorklogTextNormalizationContext | null> {
    const result = await this.db.execute(sql`
      SELECT
        record.id::text AS record_id,
        record.workspace_id::text AS workspace_id,
        record.source_id::text AS source_id,
        record.author_user_id::text AS actor_user_id,
        CASE
          WHEN source.type = 'GROUP' THEN COALESCE(source.subscription_owner_user_id, source.owner_user_id)::text
          WHEN source.type = 'PRIVATE' THEN source.private_user_id::text
          ELSE NULL
        END AS charged_user_id,
        record.raw_text
      FROM worklog_records AS record
      INNER JOIN worklog_sources AS source ON source.id = record.source_id
      WHERE record.id = ${recordId}
        AND record.input_type = 'TEXT'
        AND record.raw_text IS NOT NULL
        AND record.author_user_id IS NOT NULL
        AND record.normalized_summary IS NULL
        AND source.status = 'ACTIVE'
        AND (
          (source.type = 'GROUP' AND COALESCE(source.subscription_owner_user_id, source.owner_user_id) IS NOT NULL)
          OR (source.type = 'PRIVATE' AND source.private_user_id IS NOT NULL)
        )
      LIMIT 1
    `);
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    return {
      recordId: positiveNumeric(row.record_id, 'record_id'),
      workspaceId: positiveNumeric(row.workspace_id, 'workspace_id'),
      sourceId: positiveNumeric(row.source_id, 'source_id'),
      actorUserId: positiveNumeric(row.actor_user_id, 'actor_user_id'),
      chargedUserId: positiveNumeric(row.charged_user_id, 'charged_user_id'),
      rawText: requiredDbText(row.raw_text, 'raw_text'),
    };
  }
}

function stateResult(row: NormalizationStateRow): WorklogTextNormalizationBeginResult {
  if (row.status === 'PROVIDER_SUCCEEDED' || row.status === 'USAGE_COMMITTED') {
    return { status: row.status, payload: persistedPayload(row) };
  }
  return { status: row.status };
}

function persistedPayload(row: NormalizationStateRow): WorklogPersistedNormalizationPayload {
  if (!row.reservation_token) throw new Error('normalization state is missing reservation token');
  return {
    recordId: positiveNumeric(row.record_id, 'record_id'),
    claimToken: requiredDbText(row.claim_token, 'claim_token'),
    reservationToken: requiredDbText(row.reservation_token, 'reservation_token'),
    output: normalizeWorklogTextOutput(row.result_json),
    usage: parseUsageCommit(row.usage_commit_json),
  };
}

function parseUsageCommit(value: unknown): WorklogAiUsageCommit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('normalization state is missing AI usage snapshot');
  }
  const row = value as Record<string, unknown>;
  return {
    actualUnits: nonNegativeIntegerValue(row.actualUnits, 'actualUnits'),
    workspaceId: optionalPositiveIntegerValue(row.workspaceId, 'workspaceId'),
    recordId: optionalPositiveIntegerValue(row.recordId, 'recordId'),
    provider: requiredUnknownText(row.provider, 'provider'),
    model: requiredUnknownText(row.model, 'model'),
    inputTokens: nonNegativeIntegerValue(row.inputTokens, 'inputTokens'),
    outputTokens: nonNegativeIntegerValue(row.outputTokens, 'outputTokens'),
    audioInputUnits: nonNegativeIntegerValue(row.audioInputUnits ?? 0, 'audioInputUnits'),
    imageInputUnits: nonNegativeIntegerValue(row.imageInputUnits ?? 0, 'imageInputUnits'),
    inputUsdPerMillion: nonNegativeNumberValue(row.inputUsdPerMillion, 'inputUsdPerMillion'),
    outputUsdPerMillion: nonNegativeNumberValue(row.outputUsdPerMillion, 'outputUsdPerMillion'),
    audioUsdPerMillion: optionalNonNegativeNumberValue(row.audioUsdPerMillion, 'audioUsdPerMillion'),
    imageUsdPerMillion: optionalNonNegativeNumberValue(row.imageUsdPerMillion, 'imageUsdPerMillion'),
    usdTwdRate: optionalNonNegativeNumberValue(row.usdTwdRate, 'usdTwdRate'),
    providerCostUsd: nonNegativeNumberValue(row.providerCostUsd, 'providerCostUsd'),
    providerCostTwd: optionalNonNegativeNumberValue(row.providerCostTwd, 'providerCostTwd'),
  };
}

function requireMutation(count: number, message: string): void {
  if (count < 1) throw new Error(message);
}

function trimTo(value: string, max: number): string {
  const normalized = value.trim();
  return (normalized || 'UNKNOWN').slice(0, max);
}

function nullableTrimTo(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requiredDbText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`invalid ${name} database value`);
  return normalized;
}

function requiredUnknownText(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`invalid ${name} persisted value`);
  return requiredDbText(value, name);
}

function positiveNumeric(value: string | number, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${name} database value`);
  return parsed;
}

function nonNegativeNumeric(value: string | number, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${name} database value`);
  return parsed;
}

function nullableNonNegativeNumeric(value: string | number | null, name: string): number | null {
  return value === null ? null : nonNegativeNumeric(value, name);
}

function nonNegativeIntegerValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${name} persisted value`);
  }
  return value;
}

function optionalPositiveIntegerValue(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid ${name} persisted value`);
  }
  return value;
}

function nonNegativeNumberValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${name} persisted value`);
  }
  return value;
}

function optionalNonNegativeNumberValue(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeNumberValue(value, name);
}
