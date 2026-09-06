import type {
  AiPointCommitResult,
  AiPointReleaseResult,
  AiPointReservationResult,
} from './ai-point-ledger';
import type { WorklogAiUsageCommit } from './ai-provider-usage';

/**
 * Persisted interpretation for a newly-created LINE text Record.
 *
 * The raw Record text remains the durable source of truth. AI only proposes the
 * single filing title, a day-precision event date, and bounded retrieval metadata.
 * Ambiguous title decisions are resolved into durable confirmations.
 */
export type WorklogTextNormalizationOutput = {
  title: string | null;
  titleRequiresConfirmation: boolean;
  /** Canonical Asia/Taipei day marker encoded as an ISO instant, never meaningful clock time. */
  occurredAt: string | null;
  /** Grounded retrieval terms/synonyms only; never a replacement for rawText. */
  searchTerms: string[];
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
  /** Original source timestamp. Relative dates must resolve against this, not processing time. */
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
  /** Conservative customer-point hold estimate; positive balance is still sufficient to start. */
  reservationPoints(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  normalize(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogTextProviderResponse>;
}

export interface WorklogTextNormalizationAiPointPort {
  reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedPoints: number;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiPointReservationResult>;
  commitAiUsage(token: string, usage: WorklogAiUsageCommit, at?: Date): Promise<AiPointCommitResult>;
  releaseAi(token: string, at?: Date): Promise<AiPointReleaseResult>;
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

export class WorklogTextNormalizationService {
  constructor(
    private readonly repository: WorklogTextNormalizationRepository,
    private readonly aiPoints: WorklogTextNormalizationAiPointPort,
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

    let requestedPoints: number;
    try {
      requestedPoints = positiveInteger(
        this.provider.reservationPoints(providerInput, config),
        'requested AI points',
      );
    } catch (error) {
      const detail = errorDetail(error);
      await this.repository.setPending(context.recordId, claimToken, 'AI_RUNTIME_CONFIG_INVALID', detail);
      return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_INVALID' };
    }

    const reservation = await this.aiPoints.reserveAi({
      chargedUserId: context.chargedUserId,
      actorUserId: context.actorUserId,
      sourceId: context.sourceId,
      requestedPoints,
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

      const providerCostUsd =
        (response.inputTokens / 1_000_000) * config.inputUsdPerMillion +
        (response.outputTokens / 1_000_000) * config.outputUsdPerMillion;
      const providerCostTwd = config.usdTwdRate === null
        ? null
        : providerCostUsd * config.usdTwdRate;
      const usage: WorklogAiUsageCommit = {
        workspaceId: context.workspaceId,
        recordId: context.recordId,
        operation: 'TEXT_RECORD_CREATE',
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
      if (providerCompleted) return { status: 'IN_PROGRESS' };

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
    const committed = await this.aiPoints.commitAiUsage(payload.reservationToken, payload.usage);
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
      await this.aiPoints.releaseAi(token);
    } catch {
      // Reservation expiry is the durable fallback.
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
  const occurredAt = optionalDayMarker(
    row.occurredAt ?? row.occurred_at ?? row.occurredOn ?? row.occurred_on,
    'occurredAt',
  );
  const searchTerms = searchTermsValue(row.searchTerms ?? row.search_terms);
  return { title, titleRequiresConfirmation, occurredAt, searchTerms };
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

/** Converts YYYY-MM-DD or an RFC3339 value to the canonical Taipei day-start instant. */
function optionalDayMarker(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return taipeiDayStartIso(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), label);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${label}`);
  const taipei = new Date(parsed.getTime() + 8 * 60 * 60 * 1000);
  return taipeiDayStartIso(taipei.getUTCFullYear(), taipei.getUTCMonth() + 1, taipei.getUTCDate(), label);
}

function taipeiDayStartIso(year: number, month: number, day: number, label: string): string {
  const utc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 8 * 60 * 60 * 1000);
  const roundTrip = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() + 1 !== month
    || roundTrip.getUTCDate() !== day
  ) throw new Error(`invalid ${label}`);
  return utc.toISOString();
}

function searchTermsValue(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('searchTerms must be an array');
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('searchTerms items must be text');
    const normalized = item.trim();
    if (!normalized) continue;
    if (normalized.length > 64) throw new Error('searchTerms item is too long');
    const key = normalized.toLocaleLowerCase('zh-TW');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= 12) break;
  }
  return result;
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
