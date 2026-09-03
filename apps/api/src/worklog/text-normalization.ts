import type {
  AiCommitResult,
  AiReleaseResult,
  AiReservationResult,
  WorklogAiUsageCommit,
} from './subscription';

/**
 * Persisted interpretation for a newly-created LINE text Record.
 *
 * The raw Record text remains the durable source of truth. AI only proposes the
 * single filing title and, when explicitly present in the text, a corrected event
 * time. Ambiguous title decisions are resolved by the repository into a durable
 * worklog_ai_confirmations row instead of being guessed here.
 */
export type WorklogTextNormalizationOutput = {
  title: string | null;
  titleRequiresConfirmation: boolean;
  occurredAt: string | null;
};

export type WorklogAiRuntimeConfigSnapshot = {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  audioUsdPerMillion: number | null;
  imageUsdPerMillion: number | null;
  usdTwdRate: number | null;
};

export type WorklogTextNormalizationContext = {
  recordId: number;
  workspaceId: number;
  sourceId: number;
  actorUserId: number;
  chargedUserId: number;
  rawText: string;
  occurredAt: Date;
};

export type WorklogTextProviderInput = {
  text: string;
  /** Initial LINE/create timestamp. Relative time expressions are resolved against this. */
  referenceOccurredAt: string;
};

export type WorklogPersistedNormalizationPayload = {
  recordId: number;
  claimToken: string;
  reservationToken: string;
  output: WorklogTextNormalizationOutput;
  usage: WorklogAiUsageCommit;
};

export type WorklogTextNormalizationBeginResult =
  | { status: 'CLAIMED'; context: WorklogTextNormalizationContext; claimToken: string }
  | { status: 'PENDING' }
  | { status: 'PROCESSING' }
  | { status: 'PROVIDER_SUCCEEDED'; payload: WorklogPersistedNormalizationPayload }
  | { status: 'USAGE_COMMITTED'; payload: WorklogPersistedNormalizationPayload }
  | { status: 'SUCCEEDED' }
  | { status: 'FAILED' }
  | { status: 'NOT_ELIGIBLE' };

export type WorklogTextApplyResult =
  | { status: 'APPLIED'; entityId: number; createdEntity: boolean }
  | { status: 'PENDING_CONFIRMATION'; confirmationId: number }
  | { status: 'SKIPPED_RECORD_CHANGED' };

export interface WorklogTextNormalizationRepository {
  begin(recordId: number, claimToken: string): Promise<WorklogTextNormalizationBeginResult>;
  getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  setPending(recordId: number, claimToken: string, errorCode: string, detail?: string | null): Promise<void>;
  saveProviderResult(input: {
    recordId: number;
    claimToken: string;
    reservationToken: string;
    output: WorklogTextNormalizationOutput;
    usage: WorklogAiUsageCommit;
    providerResponseId: string | null;
    latencyMs: number;
  }): Promise<void>;
  getReservationStatus(reservationToken: string): Promise<'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null>;
  markUsageCommitted(recordId: number, claimToken: string): Promise<void>;
  applyResult(input: {
    recordId: number;
    claimToken: string;
    output: WorklogTextNormalizationOutput;
  }): Promise<WorklogTextApplyResult>;
  fail(recordId: number, claimToken: string, errorCode: string, detail?: string | null): Promise<void>;
}

export type WorklogTextProviderResponse = {
  output: WorklogTextNormalizationOutput;
  inputTokens: number;
  /** Billed output, including thinking/reasoning when the provider bills it as output. */
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface WorklogTextNormalizationProvider {
  reservationUnits(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  normalize(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogTextProviderResponse>;
}

/**
 * Transitional accounting port. The next grant-ledger batch replaces this legacy
 * subscription/aggregate-quota implementation without changing provider idempotency.
 */
export interface WorklogTextNormalizationSubscriptionPort {
  reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedUnits: number;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiReservationResult>;
  commitAiUsage(token: string, usage: WorklogAiUsageCommit, at?: Date): Promise<AiCommitResult>;
  releaseAi(token: string, at?: Date): Promise<AiReleaseResult>;
}

export type WorklogTextNormalizationResult =
  | { status: 'NORMALIZED'; entityId: number; createdEntity: boolean }
  | { status: 'PENDING_CONFIRMATION'; confirmationId: number }
  | { status: 'SKIPPED_RECORD_CHANGED' }
  | { status: 'ALREADY_NORMALIZED' }
  | { status: 'IN_PROGRESS' }
  | { status: 'DEFERRED'; reason: string }
  | { status: 'FAILED'; reason: string }
  | { status: 'NOT_ELIGIBLE' };

/**
 * AI interpretation deliberately happens after the raw LINE Record is durable.
 *
 * The state row is a one-record claim. LINE redelivery may resume after durable
 * provider success / quota settlement, but it never starts a second provider call
 * after an uncertain provider attempt. The provider output is limited to title/time;
 * raw Record content is never replaced by this pipeline.
 */
export class WorklogTextNormalizationService {
  constructor(
    private readonly repository: WorklogTextNormalizationRepository,
    private readonly subscriptions: WorklogTextNormalizationSubscriptionPort,
    private readonly provider: WorklogTextNormalizationProvider,
    private readonly tokenFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async normalizeText(recordId: number): Promise<WorklogTextNormalizationResult> {
    const normalizedRecordId = positiveInteger(recordId, 'recordId');
    const claimToken = normalizeToken(this.tokenFactory());
    const begin = await this.repository.begin(normalizedRecordId, claimToken);

    if (begin.status === 'SUCCEEDED') return { status: 'ALREADY_NORMALIZED' };
    if (begin.status === 'PROCESSING') return { status: 'IN_PROGRESS' };
    if (begin.status === 'FAILED') return { status: 'FAILED', reason: 'PREVIOUS_PROVIDER_ATTEMPT_FAILED' };
    if (begin.status === 'NOT_ELIGIBLE') return { status: 'NOT_ELIGIBLE' };
    if (begin.status === 'PENDING') return { status: 'IN_PROGRESS' };
    if (begin.status === 'PROVIDER_SUCCEEDED') return this.settleProviderResult(begin.payload);
    if (begin.status === 'USAGE_COMMITTED') return this.applyCommittedResult(begin.payload);

    return this.runClaimed(begin.context, begin.claimToken);
  }

  private async runClaimed(
    context: WorklogTextNormalizationContext,
    claimToken: string,
  ): Promise<WorklogTextNormalizationResult> {
    const config = await this.repository.getRuntimeConfig();
    if (!config) {
      await this.repository.setPending(context.recordId, claimToken, 'AI_RUNTIME_CONFIG_MISSING');
      return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };
    }

    const providerInput: WorklogTextProviderInput = {
      text: context.rawText,
      referenceOccurredAt: context.occurredAt.toISOString(),
    };

    let requestedUnits: number;
    try {
      requestedUnits = positiveInteger(
        this.provider.reservationUnits(providerInput, config),
        'requested AI units',
      );
    } catch (error) {
      const detail = errorDetail(error);
      await this.repository.setPending(context.recordId, claimToken, 'AI_RUNTIME_CONFIG_INVALID', detail);
      return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_INVALID' };
    }

    const reservation = await this.subscriptions.reserveAi({
      chargedUserId: context.chargedUserId,
      actorUserId: context.actorUserId,
      sourceId: context.sourceId,
      requestedUnits,
      ttlMs: 10 * 60_000,
    });
    if (reservation.status !== 'RESERVED') {
      await this.repository.setPending(context.recordId, claimToken, reservation.status);
      return { status: 'DEFERRED', reason: reservation.status };
    }

    const reservationToken = reservation.reservation.token;
    let payload: WorklogPersistedNormalizationPayload;
    let providerCompleted = false;
    try {
      const response = await this.provider.normalize(providerInput, config);
      providerCompleted = true;

      // Transitional aggregate quota still settles legacy units. The grant-ledger batch
      // will replace this with output-price-equivalent AI points while preserving this
      // provider-success durability boundary.
      const actualUnits = safeActualUnits(response.inputTokens, response.outputTokens);
      const providerCostUsd =
        (response.inputTokens / 1_000_000) * config.inputUsdPerMillion +
        (response.outputTokens / 1_000_000) * config.outputUsdPerMillion;
      const providerCostTwd = config.usdTwdRate === null
        ? null
        : providerCostUsd * config.usdTwdRate;
      const usage: WorklogAiUsageCommit = {
        actualUnits,
        workspaceId: context.workspaceId,
        recordId: context.recordId,
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
        recordId: context.recordId,
        claimToken,
        reservationToken,
        output: response.output,
        usage,
        providerResponseId: response.providerResponseId,
        latencyMs: nonNegativeInteger(response.latencyMs, 'latencyMs'),
      });
      payload = {
        recordId: context.recordId,
        claimToken,
        reservationToken,
        output: response.output,
        usage,
      };
    } catch (error) {
      if (providerCompleted) {
        // Provider returned, but durable persistence is uncertain. Never release the
        // reservation or automatically issue a second provider request.
        return { status: 'IN_PROGRESS' };
      }

      await this.safeRelease(reservationToken);
      const detail = errorDetail(error);
      const reason = errorCode(error);
      await this.repository.fail(context.recordId, claimToken, reason, detail);
      return { status: 'FAILED', reason };
    }

    return this.settleProviderResult(payload);
  }

  private async settleProviderResult(
    payload: WorklogPersistedNormalizationPayload,
  ): Promise<WorklogTextNormalizationResult> {
    const committed = await this.subscriptions.commitAiUsage(payload.reservationToken, payload.usage);
    if (committed.status !== 'COMMITTED') {
      const reservationStatus = await this.repository.getReservationStatus(payload.reservationToken);
      if (reservationStatus !== 'COMMITTED') {
        await this.repository.fail(
          payload.recordId,
          payload.claimToken,
          'AI_RESERVATION_NOT_COMMITTED',
          reservationStatus ?? committed.status,
        );
        return { status: 'FAILED', reason: 'AI_RESERVATION_NOT_COMMITTED' };
      }
    }

    await this.repository.markUsageCommitted(payload.recordId, payload.claimToken);
    return this.applyCommittedResult(payload);
  }

  private async applyCommittedResult(
    payload: WorklogPersistedNormalizationPayload,
  ): Promise<WorklogTextNormalizationResult> {
    const result = await this.repository.applyResult({
      recordId: payload.recordId,
      claimToken: payload.claimToken,
      output: payload.output,
    });
    if (result.status === 'APPLIED') {
      return {
        status: 'NORMALIZED',
        entityId: result.entityId,
        createdEntity: result.createdEntity,
      };
    }
    if (result.status === 'PENDING_CONFIRMATION') {
      return { status: 'PENDING_CONFIRMATION', confirmationId: result.confirmationId };
    }
    return { status: 'SKIPPED_RECORD_CHANGED' };
  }

  private async safeRelease(token: string): Promise<void> {
    try {
      await this.subscriptions.releaseAi(token);
    } catch {
      // Reservation expiry is the durable fallback. Never turn raw-record success
      // into a user-visible failure because cleanup itself had a transient DB error.
    }
  }
}

export function normalizeWorklogTextOutput(value: unknown): WorklogTextNormalizationOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('normalization output must be an object');
  }
  const row = value as Record<string, unknown>;
  const title = optionalText(row.title, 'title', 255);
  const titleRequiresConfirmation = requiredBoolean(
    row.titleRequiresConfirmation ?? row.title_requires_confirmation,
    'titleRequiresConfirmation',
  );
  const occurredAt = optionalDateTime(row.occurredAt ?? row.occurred_at, 'occurredAt');
  return { title, titleRequiresConfirmation, occurredAt };
}

function safeActualUnits(inputTokens: number, outputTokens: number): number {
  const input = nonNegativeInteger(inputTokens, 'inputTokens');
  const output = nonNegativeInteger(outputTokens, 'outputTokens');
  const total = input + output;
  if (!Number.isSafeInteger(total)) throw new Error('AI token usage exceeds safe integer range');
  return total;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function optionalDateTime(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${label}`);
  return parsed.toISOString();
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid ${label}`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(value, label, max);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function normalizeToken(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) throw new Error('invalid normalization claim token');
  return normalized;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code.slice(0, 128) || 'AI_NORMALIZATION_FAILED';
  }
  return 'AI_NORMALIZATION_FAILED';
}

function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.slice(0, 2000);
}
