import type { AiEntitlementDecision } from './ai-entitlement';
import type { WorklogAiPointLedgerService } from './ai-point-ledger';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import type {
  WorklogAiRuntimeConfigSnapshot,
  WorklogTextNormalizationOutput,
  WorklogTextNormalizationProvider,
} from './text-normalization';

export type AiTextCaptureRecord = {
  id: number;
  sourceId: number;
  authorUserId: number;
  rawText: string;
  title: string | null;
  searchTerms: string[];
  occurredAt: string | null;
  createdAt: string;
};

export type AiTextCaptureRepository = {
  runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  createAiRecord(input: {
    userId: number;
    sourceId: number;
    rawText: string;
    output: WorklogTextNormalizationOutput;
    enrichedAt: Date;
  }): Promise<{ record: AiTextCaptureRecord; workspaceId: number | null }>;
};

export type AiTextCaptureEntitlementPort = {
  resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision>;
  admit(userId: number, sourceId: number, requestedPoints: number, at?: Date): Promise<AiEntitlementDecision>;
};

export type AiTextCaptureResult =
  | { status: 'CREATED'; entitlementSource: 'FREE_TRIAL' | 'AI_PRO'; record: AiTextCaptureRecord }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'DEFERRED'; reason: 'AI_RUNTIME_CONFIG_MISSING' }
  | { status: 'FAILED'; reason: string };

/**
 * Target Web/PWA/Chrome provider-backed text capture path.
 *
 * Manual capture does not use this service. A read-only entitlement resolution first hides
 * runtime/provider state from unauthorized Sources. Provider work starts only after the
 * request-specific `admit()` check and a durable point reservation. Provider success is
 * always settled/audited even when a later Record write fails.
 */
export class AiTextCaptureService {
  constructor(
    private readonly repository: AiTextCaptureRepository,
    private readonly entitlement: AiTextCaptureEntitlementPort,
    private readonly ledger: WorklogAiPointLedgerService,
    private readonly provider: WorklogTextNormalizationProvider,
  ) {}

  async capture(input: {
    userId: number;
    sourceId: number;
    text: string;
    referenceAt?: Date;
  }): Promise<AiTextCaptureResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID');
    const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID');
    const text = requiredText(input.text, 20_000, 'AI_CAPTURE_TEXT_REQUIRED');
    const referenceAt = validDate(input.referenceAt ?? new Date());

    const preliminary = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!preliminary.allowed || preliminary.source === 'BLOCKED') {
      return { status: 'BLOCKED', decision: preliminary };
    }

    const config = await this.repository.runtimeConfig();
    if (!config) return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };

    const providerInput = { text, referenceOccurredAt: referenceAt.toISOString() };
    let requestedPoints: number;
    try {
      requestedPoints = positiveId(
        this.provider.reservationPoints(providerInput, config),
        'AI_RESERVATION_ESTIMATE_INVALID',
      );
    } catch (error) {
      return { status: 'FAILED', reason: errorCode(error, 'AI_RESERVATION_ESTIMATE_INVALID') };
    }

    const decision = await this.entitlement.admit(userId, sourceId, requestedPoints, referenceAt);
    if (!decision.allowed || decision.source === 'BLOCKED') {
      return { status: 'BLOCKED', decision };
    }

    const reservation = await this.ledger.reserveAi({
      chargedUserId: userId,
      actorUserId: userId,
      sourceId,
      requestedPoints,
      at: referenceAt,
      ttlMs: 10 * 60_000,
    });
    if (reservation.status !== 'RESERVED') {
      return {
        status: 'BLOCKED',
        decision: {
          source: 'BLOCKED',
          allowed: false,
          reason: decision.source === 'FREE_TRIAL' ? 'TRIAL_EXHAUSTED' : 'MONTHLY_POINT_CAP_REACHED',
          remainingPoints: 0,
          periodEndsAt: decision.periodEndsAt,
        },
      };
    }

    const token = reservation.reservation.token;
    let providerResponse: Awaited<ReturnType<WorklogTextNormalizationProvider['normalize']>>;
    try {
      providerResponse = await this.provider.normalize(providerInput, config);
    } catch (error) {
      await safeRelease(this.ledger, token);
      return { status: 'FAILED', reason: errorCode(error, 'AI_PROVIDER_FAILED') };
    }

    const usageBase = usageFromProvider(config, providerResponse);
    let created: { record: AiTextCaptureRecord; workspaceId: number | null } | null = null;
    try {
      created = await this.repository.createAiRecord({
        userId,
        sourceId,
        rawText: text,
        output: providerResponse.output,
        enrichedAt: new Date(),
      });
    } catch (error) {
      await settleProviderSuccess(this.ledger, token, { ...usageBase, operation: 'AI_TEXT_CAPTURE' });
      return { status: 'FAILED', reason: errorCode(error, 'AI_RECORD_CREATE_FAILED') };
    }

    const settled = await this.ledger.commitAiUsage(token, {
      ...usageBase,
      workspaceId: created.workspaceId,
      recordId: created.record.id,
      operation: 'AI_TEXT_CAPTURE',
    });
    if (settled.status !== 'COMMITTED') {
      return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
    }

    return {
      status: 'CREATED',
      entitlementSource: decision.source,
      record: created.record,
    };
  }
}

function usageFromProvider(
  config: WorklogAiRuntimeConfigSnapshot,
  response: Awaited<ReturnType<WorklogTextNormalizationProvider['normalize']>>,
): WorklogAiUsageCommit {
  const providerCostUsd =
    (response.inputTokens / 1_000_000) * config.inputUsdPerMillion
    + (response.outputTokens / 1_000_000) * config.outputUsdPerMillion;
  return {
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
    providerCostTwd: config.usdTwdRate === null ? null : providerCostUsd * config.usdTwdRate,
  };
}

async function settleProviderSuccess(
  ledger: WorklogAiPointLedgerService,
  token: string,
  usage: WorklogAiUsageCommit,
): Promise<void> {
  try { await ledger.commitAiUsage(token, usage); } catch { /* durable reservation/usage diagnostics handle failure */ }
}

async function safeRelease(ledger: WorklogAiPointLedgerService, token: string): Promise<void> {
  try { await ledger.releaseAi(token); } catch { /* reservation expiry is fallback */ }
}

function positiveId(value: number, error: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
  return value;
}

function requiredText(value: string, max: number, error: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_REFERENCE_TIME');
  return new Date(value.getTime());
}

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const candidate = 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code: string }).code)
      : error.message;
    if (/^[A-Z0-9_]+$/.test(candidate)) return candidate;
  }
  return fallback;
}
