import type {
  AiCommitResult,
  AiReleaseResult,
  AiReservationResult,
  WorklogAiUsageCommit,
} from './subscription';

export type WorklogTextCategory =
  | 'NOTE'
  | 'WORK'
  | 'ISSUE'
  | 'PAYMENT'
  | 'EXPENSE'
  | 'MATERIAL'
  | 'OTHER';

export type WorklogTextNormalizationOutput = {
  summary: string;
  category: WorklogTextCategory;
  customerHint: string | null;
  projectHint: string | null;
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
  }): Promise<void>;
  fail(recordId: number, claimToken: string, errorCode: string, detail?: string | null): Promise<void>;
}

export type WorklogTextProviderResponse = {
  output: WorklogTextNormalizationOutput;
  inputTokens: number;
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface WorklogTextNormalizationProvider {
  reservationUnits(text: string, config: WorklogAiRuntimeConfigSnapshot): number;
  normalize(text: string, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogTextProviderResponse>;
}

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
  | { status: 'NORMALIZED' }
  | { status: 'ALREADY_NORMALIZED' }
  | { status: 'IN_PROGRESS' }
  | { status: 'DEFERRED'; reason: string }
  | { status: 'FAILED'; reason: string }
  | { status: 'NOT_ELIGIBLE' };

/**
 * AI normalization deliberately happens after the raw LINE record is durable.
 *
 * The state row is a one-record claim. LINE redelivery is allowed to resume a
 * provider-success / quota-success boundary, but it never starts a second provider
 * call after an uncertain provider attempt. That protects internal quota from
 * duplicate charging and prefers an un-normalized raw record over invented recovery.
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

    let requestedUnits: number;
    try {
      requestedUnits = positiveInteger(
        this.provider.reservationUnits(context.rawText, config),
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
      const response = await this.provider.normalize(context.rawText, config);
      providerCompleted = true;
      const actualUnits = safeActualUnits(response.inputTokens, response.outputTokens);
      if (actualUnits > reservation.reservation.unitsReserved) {
        await this.safeRelease(reservationToken);
        await this.repository.fail(
          context.recordId,
          claimToken,
          'AI_USAGE_EXCEEDED_RESERVATION',
          `${actualUnits} > ${reservation.reservation.unitsReserved}`,
        );
        return { status: 'FAILED', reason: 'AI_USAGE_EXCEEDED_RESERVATION' };
      }

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
        // The provider definitely returned, but durable persistence of that result is
        // uncertain. Do not release quota and do not mark this retryable: doing either
        // could under-account provider cost or permit an automatic second provider call.
        // The repository will terminalize stale PROCESSING state for operator review.
        return { status: 'IN_PROGRESS' };
      }

      // Provider execution itself failed before a usable response existed. This path
      // is terminal and cannot be automatically replayed by LINE redelivery.
      await this.safeRelease(reservationToken);
      const detail = errorDetail(error);
      const reason = errorCode(error);
      await this.repository.fail(context.recordId, claimToken, reason, detail);
      return { status: 'FAILED', reason };
    }

    // From this point onward provider output is durable. Do not catch settlement DB
    // failures here: PROVIDER_SUCCEEDED / USAGE_COMMITTED are resumable states, and a
    // redelivery can finish them without another provider call or quota charge.
    return this.settleProviderResult(payload);
  }

  private async settleProviderResult(
    payload: WorklogPersistedNormalizationPayload,
  ): Promise<WorklogTextNormalizationResult> {
    const committed = await this.subscriptions.commitAiUsage(payload.reservationToken, payload.usage);
    if (committed.status !== 'COMMITTED') {
      if (committed.status !== 'RESERVATION_NOT_ACTIVE') {
        await this.repository.fail(payload.recordId, payload.claimToken, committed.status);
        return { status: 'FAILED', reason: committed.status };
      }

      // A worker can disappear after the quota transaction committed but before the
      // normalization state was advanced. Read the durable reservation status so a
      // LINE redelivery can finish the record without charging or calling AI again.
      const reservationStatus = await this.repository.getReservationStatus(payload.reservationToken);
      if (reservationStatus !== 'COMMITTED') {
        await this.repository.fail(
          payload.recordId,
          payload.claimToken,
          'AI_RESERVATION_NOT_COMMITTED',
          reservationStatus ?? 'NOT_FOUND',
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
    await this.repository.applyResult({
      recordId: payload.recordId,
      claimToken: payload.claimToken,
      output: payload.output,
    });
    return { status: 'NORMALIZED' };
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
  const summary = requiredText(row.summary, 'summary', 2000);
  const category = requiredCategory(row.category);
  return {
    summary,
    category,
    customerHint: optionalText(row.customerHint ?? row.customer_hint, 'customerHint', 255),
    projectHint: optionalText(row.projectHint ?? row.project_hint, 'projectHint', 255),
  };
}

function safeActualUnits(inputTokens: number, outputTokens: number): number {
  const input = nonNegativeInteger(inputTokens, 'inputTokens');
  const output = nonNegativeInteger(outputTokens, 'outputTokens');
  const total = input + output;
  if (!Number.isSafeInteger(total)) throw new Error('AI token usage exceeds safe integer range');
  return total;
}

function requiredCategory(value: unknown): WorklogTextCategory {
  const allowed: WorklogTextCategory[] = [
    'NOTE',
    'WORK',
    'ISSUE',
    'PAYMENT',
    'EXPENSE',
    'MATERIAL',
    'OTHER',
  ];
  if (typeof value !== 'string' || !allowed.includes(value as WorklogTextCategory)) {
    throw new Error('invalid worklog category');
  }
  return value as WorklogTextCategory;
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
