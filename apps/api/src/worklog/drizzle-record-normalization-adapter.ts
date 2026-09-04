import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import type {
  WorklogTextNormalizationBeginResult,
  WorklogTextNormalizationContext,
  WorklogTextNormalizationRepository,
} from './text-normalization';
import { DrizzleWorklogTextNormalizationRepository } from './drizzle-text-normalization';

type NormalizationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROVIDER_SUCCEEDED'
  | 'USAGE_COMMITTED'
  | 'SUCCEEDED'
  | 'FAILED';

type StateRow = {
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
  occurred_at: Date | string;
};

/**
 * Extends the established TEXT title/time normalization state machine to durable
 * attachment Records without duplicating Entity/Alias matching or confirmation logic.
 * TEXT Records continue through the original repository unchanged.
 */
export class DrizzleWorklogRecordNormalizationRepository implements WorklogTextNormalizationRepository {
  private readonly base: DrizzleWorklogTextNormalizationRepository;

  constructor(private readonly db: Database) {
    this.base = new DrizzleWorklogTextNormalizationRepository(db);
  }

  async begin(recordId: number, claimToken: string): Promise<WorklogTextNormalizationBeginResult> {
    const inputType = await this.recordInputType(recordId);
    if (inputType === 'TEXT') return this.base.begin(recordId, claimToken);
    if (inputType !== 'AUDIO' && inputType !== 'IMAGE' && inputType !== 'FILE') {
      return { status: 'NOT_ELIGIBLE' };
    }

    await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET status = 'FAILED',
          last_error_code = 'AI_NORMALIZATION_PROCESSING_STALE_UNCERTAIN',
          last_error_detail = 'Provider execution or provider-result persistence became uncertain; automatic replay is disabled.',
          updated_at = NOW()
      WHERE record_id = ${recordId}
        AND status = 'PROCESSING'
        AND updated_at < NOW() - INTERVAL '15 minutes'
    `);

    const current = await this.loadState(recordId);
    if (current) {
      if (current.status !== 'PENDING') {
        // Existing PROCESSING/provider-success/committed/succeeded/failed states are
        // parsed by the established repository before its TEXT-only context loader.
        return this.base.begin(recordId, claimToken);
      }

      const claimed = await this.db.execute(sql`
        UPDATE worklog_record_ai_normalizations
        SET status = 'PROCESSING',
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
        const context = await this.loadAttachmentContext(recordId);
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
      if (!winner) return { status: 'NOT_ELIGIBLE' };
      if (winner.status === 'PENDING') return { status: 'IN_PROGRESS' };
      return this.base.begin(recordId, claimToken);
    }

    const context = await this.loadAttachmentContext(recordId);
    if (!context) return { status: 'NOT_ELIGIBLE' };

    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_record_ai_normalizations (
        record_id, status, claim_token, started_at, created_at, updated_at
      ) VALUES (
        ${recordId}, 'PROCESSING', ${claimToken}, NOW(), NOW(), NOW()
      )
      ON CONFLICT (record_id) DO NOTHING
      RETURNING record_id
    `);
    if (inserted.rows.length > 0) return { status: 'CLAIMED', context, claimToken };

    const winner = await this.loadState(recordId);
    if (!winner) return { status: 'NOT_ELIGIBLE' };
    if (winner.status === 'PENDING') return { status: 'IN_PROGRESS' };
    return this.base.begin(recordId, claimToken);
  }

  getRuntimeConfig() { return this.base.getRuntimeConfig(); }
  setPending(recordId: number, claimToken: string, errorCode: string, detail?: string | null) {
    return this.base.setPending(recordId, claimToken, errorCode, detail);
  }

  async saveProviderResult(input: Parameters<WorklogTextNormalizationRepository['saveProviderResult']>[0]) {
    const usage = await this.normalizeUsageOperation(input.usage);
    return this.base.saveProviderResult({ ...input, usage });
  }

  getReservationStatus(reservationToken: string) { return this.base.getReservationStatus(reservationToken); }
  markUsageCommitted(recordId: number, claimToken: string) { return this.base.markUsageCommitted(recordId, claimToken); }
  applyResult(input: Parameters<WorklogTextNormalizationRepository['applyResult']>[0]) { return this.base.applyResult(input); }
  fail(recordId: number, claimToken: string, errorCode: string, detail?: string | null) {
    return this.base.fail(recordId, claimToken, errorCode, detail);
  }

  async normalizeUsageOperation(usage: WorklogAiUsageCommit): Promise<WorklogAiUsageCommit> {
    if (!usage.recordId) return usage;
    const inputType = await this.recordInputType(usage.recordId);
    if (inputType === 'AUDIO' || inputType === 'IMAGE' || inputType === 'FILE') {
      return { ...usage, operation: 'RECORD_TITLE_NORMALIZATION' };
    }
    return usage;
  }

  private async recordInputType(recordId: number): Promise<string | null> {
    const result = await this.db.execute(sql`
      SELECT input_type FROM worklog_records WHERE id = ${recordId} LIMIT 1
    `);
    const value = (result.rows[0] as { input_type?: unknown } | undefined)?.input_type;
    return typeof value === 'string' ? value : null;
  }

  private async loadAttachmentContext(recordId: number): Promise<WorklogTextNormalizationContext | null> {
    const result = await this.db.execute(sql`
      SELECT record.id::text AS record_id,
             source.workspace_id::text AS workspace_id,
             record.source_id::text AS source_id,
             record.author_user_id::text AS actor_user_id,
             CASE
               WHEN source.type = 'GROUP' THEN responsibility.responsible_user_id::text
               WHEN source.type = 'PRIVATE' THEN source.private_user_id::text
               ELSE NULL
             END AS charged_user_id,
             record.raw_text,
             record.occurred_at
      FROM worklog_records AS record
      INNER JOIN worklog_sources AS source ON source.id = record.source_id
      LEFT JOIN worklog_source_ai_responsibility AS responsibility ON responsibility.source_id = source.id
      LEFT JOIN worklog_source_members AS responsible_member
        ON responsible_member.source_id = source.id
       AND responsible_member.user_id = responsibility.responsible_user_id
      WHERE record.id = ${recordId}
        AND record.input_type IN ('AUDIO', 'IMAGE', 'FILE')
        AND BTRIM(record.raw_text) <> ''
        AND record.author_user_id IS NOT NULL
        AND record.entity_id IS NULL
        AND record.status = 'ACTIVE'
        AND record.version = 1
        AND source.status = 'ACTIVE'
        AND (
          (source.type = 'GROUP'
            AND responsibility.responsible_user_id IS NOT NULL
            AND responsible_member.is_active = TRUE)
          OR (source.type = 'PRIVATE' AND source.private_user_id IS NOT NULL)
        )
      LIMIT 1
    `);
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    return {
      recordId: positiveInteger(row.record_id, 'record_id'),
      workspaceId: positiveInteger(row.workspace_id, 'workspace_id'),
      sourceId: positiveInteger(row.source_id, 'source_id'),
      actorUserId: positiveInteger(row.actor_user_id, 'actor_user_id'),
      chargedUserId: positiveInteger(row.charged_user_id, 'charged_user_id'),
      rawText: requiredText(row.raw_text, 'raw_text'),
      occurredAt: validDate(row.occurred_at, 'occurred_at'),
    };
  }

  private async loadState(recordId: number): Promise<StateRow | null> {
    const result = await this.db.execute(sql`
      SELECT record_id::text AS record_id, status, claim_token, reservation_token,
             result_json, usage_commit_json
      FROM worklog_record_ai_normalizations
      WHERE record_id = ${recordId}
      LIMIT 1
    `);
    return (result.rows[0] as StateRow | undefined) ?? null;
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function validDate(value: unknown, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid ${label}`);
  return date;
}
