import type { WorklogTextNormalizationAiPointPort, WorklogAiRuntimeConfigSnapshot } from './text-normalization';
import { providerCostToAiPoints } from './ai-points';
import type { WorklogAiUsageCommit } from './subscription';
import type { WorklogReplyEditTarget } from './records';

export type WorklogLineRecordEditOutput = {
  rawText: string;
  /** null means keep the current occurred_at. */
  occurredAt: string | null;
  /** null means keep the current single title. */
  title: string | null;
  titleRequiresConfirmation: boolean;
};

export type WorklogLineRecordEditContext = {
  editId: number;
  workspaceId: number;
  sourceId: number;
  recordId: number;
  actorUserId: number;
  chargedUserId: number;
  instruction: string;
  commandTimestamp: Date;
  expectedRecordVersion: number;
  currentRawText: string;
  currentOccurredAt: Date;
  currentEntityId: number | null;
  currentTitle: string | null;
};

export type WorklogLineRecordEditProviderInput = {
  instruction: string;
  commandTimestamp: string;
  currentRawText: string;
  currentOccurredAt: string;
  currentTitle: string | null;
};

export type WorklogLineRecordEditProviderResponse = {
  output: WorklogLineRecordEditOutput;
  inputTokens: number;
  /** Billed output, including thinking/reasoning when provider pricing treats it as output. */
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface WorklogLineRecordEditProvider {
  reservationUnits(input: WorklogLineRecordEditProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  edit(input: WorklogLineRecordEditProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogLineRecordEditProviderResponse>;
}

export type WorklogPersistedLineEditPayload = {
  editId: number;
  claimToken: string;
  reservationToken: string;
  output: WorklogLineRecordEditOutput;
  usage: WorklogAiUsageCommit;
};

export type WorklogLineRecordEditBeginResult =
  | { status: 'CLAIMED'; context: WorklogLineRecordEditContext; claimToken: string }
  | { status: 'PROCESSING' }
  | { status: 'PROVIDER_SUCCEEDED'; payload: WorklogPersistedLineEditPayload }
  | { status: 'USAGE_COMMITTED'; payload: WorklogPersistedLineEditPayload }
  | { status: 'PENDING_CONFIRMATION'; confirmationId: number }
  | { status: 'SUCCEEDED'; recordVersion: number; entityId: number }
  | { status: 'RECORD_CHANGED' }
  | { status: 'FAILED'; reason: string }
  | { status: 'IDEMPOTENCY_CONFLICT' }
  | { status: 'NOT_ELIGIBLE' };

export type WorklogLineRecordEditApplyResult =
  | { status: 'APPLIED'; recordVersion: number; entityId: number }
  | { status: 'PENDING_CONFIRMATION'; confirmationId: number }
  | { status: 'RECORD_CHANGED' };

export interface WorklogLineRecordEditRepository {
  begin(input: {
    sourceId: number;
    recordId: number;
    actorUserId: number;
    chargedUserId: number;
    lineCommandMessageId: string;
    quotedLineMessageId: string;
    commandTimestamp: Date;
    instruction: string;
    expectedRecordVersion: number;
    claimToken: string;
  }): Promise<WorklogLineRecordEditBeginResult>;
  getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  saveProviderResult(input: {
    editId: number;
    claimToken: string;
    reservationToken: string;
    output: WorklogLineRecordEditOutput;
    usage: WorklogAiUsageCommit;
    providerResponseId: string | null;
    latencyMs: number;
  }): Promise<void>;
  getReservationStatus(reservationToken: string): Promise<'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null>;
  markUsageCommitted(editId: number, claimToken: string): Promise<void>;
  applyResult(input: {
    editId: number;
    claimToken: string;
    output: WorklogLineRecordEditOutput;
  }): Promise<WorklogLineRecordEditApplyResult>;
  fail(editId: number, claimToken: string, errorCode: string, detail?: string | null): Promise<void>;
}

export type WorklogLineRecordEditResult =
  | { status: 'EDITED'; recordVersion: number; entityId: number }
  | { status: 'PENDING_CONFIRMATION'; confirmationId: number }
  | { status: 'RECORD_CHANGED' }
  | { status: 'IN_PROGRESS' }
  | { status: 'AI_POINTS_EXHAUSTED' }
  | { status: 'IDEMPOTENCY_CONFLICT' }
  | { status: 'NOT_ELIGIBLE' }
  | { status: 'FAILED'; reason: string };

/**
 * Executes a Reply-targeted Record edit with the same provider/result/settlement safety
 * properties as LINE create normalization, but never mutates before the paid provider
 * result is durable and settled.
 */
export class WorklogLineRecordEditService {
  constructor(
    private readonly repository: WorklogLineRecordEditRepository,
    private readonly aiPoints: WorklogTextNormalizationAiPointPort,
    private readonly provider: WorklogLineRecordEditProvider,
    private readonly tokenFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async edit(input: {
    target: WorklogReplyEditTarget;
    actorUserId: number;
    chargedUserId: number;
    lineCommandMessageId: string;
    quotedLineMessageId: string;
    commandTimestamp: Date;
    instruction: string;
  }): Promise<WorklogLineRecordEditResult> {
    const target = normalizeTarget(input.target);
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const chargedUserId = positiveInteger(input.chargedUserId, 'chargedUserId');
    const lineCommandMessageId = requiredText(input.lineCommandMessageId, 'lineCommandMessageId', 64);
    const quotedLineMessageId = requiredText(input.quotedLineMessageId, 'quotedLineMessageId', 64);
    const instruction = requiredText(input.instruction, 'instruction', 4_000);
    const commandTimestamp = validDate(input.commandTimestamp, 'commandTimestamp');
    const claimToken = requiredText(this.tokenFactory(), 'claimToken', 64);

    const begin = await this.repository.begin({
      sourceId: target.sourceId,
      recordId: target.id,
      actorUserId,
      chargedUserId,
      lineCommandMessageId,
      quotedLineMessageId,
      commandTimestamp,
      instruction,
      expectedRecordVersion: target.version,
      claimToken,
    });

    if (begin.status === 'PROCESSING') return { status: 'IN_PROGRESS' };
    if (begin.status === 'PENDING_CONFIRMATION') return begin;
    if (begin.status === 'SUCCEEDED') return { status: 'EDITED', recordVersion: begin.recordVersion, entityId: begin.entityId };
    if (begin.status === 'RECORD_CHANGED') return { status: 'RECORD_CHANGED' };
    if (begin.status === 'FAILED') return { status: 'FAILED', reason: begin.reason };
    if (begin.status === 'IDEMPOTENCY_CONFLICT') return { status: 'IDEMPOTENCY_CONFLICT' };
    if (begin.status === 'NOT_ELIGIBLE') return { status: 'NOT_ELIGIBLE' };
    if (begin.status === 'PROVIDER_SUCCEEDED') return this.settleProviderResult(begin.payload);
    if (begin.status === 'USAGE_COMMITTED') return this.applyCommittedResult(begin.payload);

    return this.runClaimed(begin.context, begin.claimToken);
  }

  private async runClaimed(
    context: WorklogLineRecordEditContext,
    claimToken: string,
  ): Promise<WorklogLineRecordEditResult> {
    const config = await this.repository.getRuntimeConfig();
    if (!config) {
      await this.repository.fail(context.editId, claimToken, 'AI_RUNTIME_CONFIG_MISSING');
      return { status: 'FAILED', reason: 'AI_RUNTIME_CONFIG_MISSING' };
    }

    const providerInput: WorklogLineRecordEditProviderInput = {
      instruction: context.instruction,
      commandTimestamp: context.commandTimestamp.toISOString(),
      currentRawText: context.currentRawText,
      currentOccurredAt: context.currentOccurredAt.toISOString(),
      currentTitle: context.currentTitle,
    };

    let requestedPoints: number;
    try {
      requestedPoints = positiveInteger(
        this.provider.reservationUnits(providerInput, config),
        'requested AI points',
      );
    } catch (error) {
      await this.repository.fail(context.editId, claimToken, 'AI_RUNTIME_CONFIG_INVALID', errorDetail(error));
      return { status: 'FAILED', reason: 'AI_RUNTIME_CONFIG_INVALID' };
    }

    const reservation = await this.aiPoints.reserveAi({
      chargedUserId: context.chargedUserId,
      actorUserId: context.actorUserId,
      sourceId: context.sourceId,
      requestedUnits: requestedPoints,
      ttlMs: 10 * 60_000,
    });
    if (reservation.status !== 'RESERVED') {
      await this.repository.fail(context.editId, claimToken, reservation.status);
      return { status: 'AI_POINTS_EXHAUSTED' };
    }

    const reservationToken = reservation.reservation.token;
    let providerCompleted = false;
    let payload: WorklogPersistedLineEditPayload;
    try {
      const response = await this.provider.edit(providerInput, config);
      providerCompleted = true;
      const providerCostUsd =
        (response.inputTokens / 1_000_000) * config.inputUsdPerMillion +
        (response.outputTokens / 1_000_000) * config.outputUsdPerMillion;
      const providerCostTwd = config.usdTwdRate === null ? null : providerCostUsd * config.usdTwdRate;
      const actualPoints = providerCostToAiPoints({
        providerCostUsd,
        outputUsdPerMillion: config.outputUsdPerMillion,
      });
      const usage: WorklogAiUsageCommit = {
        actualUnits: actualPoints,
        workspaceId: context.workspaceId,
        recordId: context.recordId,
        operation: 'TEXT_RECORD_EDIT',
        provider: config.provider,
        model: config.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        audioInputUnits: 0,
        imageInputUnits: 0,
        inputUsdPerMillion: config.inputUsdPerMillion,
        outputUsdPerMillion: config.outputUsdPerMillion,
        audioUsdPerMillion: config.audioUsdPerMillion,
        imageUsdPerMillion: config.imageUsdPerMillion,
        usdTwdRate: config.usdTwdRate,
        providerCostUsd,
        providerCostTwd,
      };

      await this.repository.saveProviderResult({
        editId: context.editId,
        claimToken,
        reservationToken,
        output: normalizeWorklogLineRecordEditOutput(response.output),
        usage,
        providerResponseId: response.providerResponseId,
        latencyMs: nonNegativeInteger(response.latencyMs, 'latencyMs'),
      });
      payload = {
        editId: context.editId,
        claimToken,
        reservationToken,
        output: normalizeWorklogLineRecordEditOutput(response.output),
        usage,
      };
    } catch (error) {
      if (providerCompleted) {
        // The provider may already have charged us. Do not release the hold or call the
        // provider again when durable result persistence is uncertain.
        return { status: 'IN_PROGRESS' };
      }
      await this.safeRelease(reservationToken);
      const reason = errorCode(error);
      await this.repository.fail(context.editId, claimToken, reason, errorDetail(error));
      return { status: 'FAILED', reason };
    }

    return this.settleProviderResult(payload);
  }

  private async settleProviderResult(
    payload: WorklogPersistedLineEditPayload,
  ): Promise<WorklogLineRecordEditResult> {
    const committed = await this.aiPoints.commitAiUsage(payload.reservationToken, payload.usage);
    if (committed.status !== 'COMMITTED') {
      const reservationStatus = await this.repository.getReservationStatus(payload.reservationToken);
      if (reservationStatus !== 'COMMITTED') {
        await this.repository.fail(
          payload.editId,
          payload.claimToken,
          'AI_RESERVATION_NOT_COMMITTED',
          reservationStatus ?? committed.status,
        );
        return { status: 'FAILED', reason: 'AI_RESERVATION_NOT_COMMITTED' };
      }
    }
    await this.repository.markUsageCommitted(payload.editId, payload.claimToken);
    return this.applyCommittedResult(payload);
  }

  private async applyCommittedResult(
    payload: WorklogPersistedLineEditPayload,
  ): Promise<WorklogLineRecordEditResult> {
    const applied = await this.repository.applyResult({
      editId: payload.editId,
      claimToken: payload.claimToken,
      output: payload.output,
    });
    if (applied.status === 'APPLIED') {
      return { status: 'EDITED', recordVersion: applied.recordVersion, entityId: applied.entityId };
    }
    if (applied.status === 'PENDING_CONFIRMATION') return applied;
    return { status: 'RECORD_CHANGED' };
  }

  private async safeRelease(token: string): Promise<void> {
    try { await this.aiPoints.releaseAi(token); } catch { /* durable expiry is fallback */ }
  }
}

export function normalizeWorklogLineRecordEditOutput(value: unknown): WorklogLineRecordEditOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('edit output must be an object');
  const row = value as Record<string, unknown>;
  const rawText = requiredText(row.rawText ?? row.raw_text, 'rawText', 20_000);
  const occurredAt = optionalDateTime(row.occurredAt ?? row.occurred_at, 'occurredAt');
  const title = optionalText(row.title, 'title', 255);
  const titleRequiresConfirmation = row.titleRequiresConfirmation ?? row.title_requires_confirmation;
  if (typeof titleRequiresConfirmation !== 'boolean') throw new Error('titleRequiresConfirmation must be boolean');
  return { rawText, occurredAt, title, titleRequiresConfirmation };
}

function normalizeTarget(value: WorklogReplyEditTarget): WorklogReplyEditTarget {
  return {
    id: positiveInteger(value.id, 'recordId'),
    sourceId: positiveInteger(value.sourceId, 'sourceId'),
    authorUserId: value.authorUserId == null ? null : positiveInteger(value.authorUserId, 'authorUserId'),
    entityId: value.entityId == null ? null : positiveInteger(value.entityId, 'entityId'),
    rawText: requiredText(value.rawText, 'currentRawText', 20_000),
    occurredAt: validDate(new Date(value.occurredAt), 'currentOccurredAt').toISOString(),
    version: positiveInteger(value.version, 'recordVersion'),
  };
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`${label} is too long`);
  return normalized;
}

function optionalDateTime(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  return validDate(new Date(normalized), label).toISOString();
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > max) throw new Error(`${label} is too long`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}

function errorCode(error: unknown): string {
  const value = error as { code?: unknown } | null;
  return typeof value?.code === 'string' && value.code.trim() ? value.code.trim().slice(0, 128) : 'AI_EDIT_PROVIDER_FAILED';
}

function errorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}
