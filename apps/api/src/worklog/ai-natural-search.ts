import type { AiEntitlementDecision } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { aiPointReservationCostHoldTwd } from './ai-points';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import { snapshotAiUsage } from './entitlements';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export type AiNaturalSearchInterpretation = {
  terms: string[];
  from: string | null;
  to: string | null;
};

export type AiNaturalSearchProviderInput = {
  query: string;
  referenceAt: string;
  timeZone: string;
};

export type AiNaturalSearchProviderResponse = {
  interpretation: AiNaturalSearchInterpretation;
  inputTokens: number;
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface AiNaturalSearchProvider {
  reservationPoints(input: AiNaturalSearchProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  interpret(input: AiNaturalSearchProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<AiNaturalSearchProviderResponse>;
}

export type AiNaturalSearchRecord = {
  id: number;
  sourceId: number;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  title: string | null;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
};

export interface AiNaturalSearchRepository {
  searchEnabled(): Promise<boolean>;
  runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  searchRecords(input: {
    sourceId: number;
    terms: string[];
    from: Date | null;
    to: Date | null;
    limit: number;
  }): Promise<AiNaturalSearchRecord[]>;
}

export type AiNaturalSearchEntitlementPort = {
  resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision>;
};

export type AiNaturalSearchResult =
  | {
      status: 'RESULTS';
      entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
      interpretation: AiNaturalSearchInterpretation;
      records: AiNaturalSearchRecord[];
    }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'DEFERRED'; reason: 'AI_RUNTIME_CONFIG_MISSING' }
  | { status: 'FAILED'; reason: string };

export class AiNaturalSearchService {
  constructor(
    private readonly repository: AiNaturalSearchRepository,
    private readonly entitlement: AiNaturalSearchEntitlementPort,
    private readonly aiPoints: AiPointLedgerPort,
    private readonly provider: AiNaturalSearchProvider,
  ) {}

  async search(input: {
    userId: number;
    sourceId: number;
    query: string;
    timeZone?: string;
    referenceAt?: Date;
    limit?: number;
  }): Promise<AiNaturalSearchResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID');
    const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID');
    const query = requiredText(input.query, 1000, 'AI_SEARCH_QUERY_REQUIRED');
    const referenceAt = validDate(input.referenceAt ?? new Date());
    const timeZone = validTimeZone(input.timeZone ?? 'Asia/Taipei');
    const limit = boundedLimit(input.limit ?? 20);

    const preliminary = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!preliminary.allowed || preliminary.source === 'BLOCKED') return { status: 'BLOCKED', decision: preliminary };
    if (!(await this.repository.searchEnabled())) return { status: 'FAILED', reason: 'AI_NATURAL_SEARCH_DISABLED' };

    const config = await this.repository.runtimeConfig();
    if (!config) return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };

    const providerInput: AiNaturalSearchProviderInput = {
      query,
      referenceAt: referenceAt.toISOString(),
      timeZone,
    };
    let requestedPoints: number;
    let providerCostHoldTwd: number | null;
    try {
      requestedPoints = positiveId(this.provider.reservationPoints(providerInput, config), 'AI_RESERVATION_ESTIMATE_INVALID');
      providerCostHoldTwd = aiPointReservationCostHoldTwd({
        points: requestedPoints,
        outputUsdPerMillion: config.outputUsdPerMillion,
        usdTwdRate: config.usdTwdRate,
      });
    } catch (error) {
      return { status: 'FAILED', reason: errorCode(error, 'AI_RESERVATION_ESTIMATE_INVALID') };
    }

    const reservation = await this.aiPoints.reserveAi({
      chargedUserId: userId,
      actorUserId: userId,
      sourceId,
      requestedPoints,
      providerCostHoldTwd,
      at: referenceAt,
      ttlMs: 10 * 60_000,
    });
    if (reservation.status !== 'RESERVED') {
      return {
        status: 'BLOCKED',
        decision: blockedDecision(preliminary, reservation.status, reservation.status === 'AI_ENTITLEMENT_BLOCKED' ? reservation.reason : null),
      };
    }

    const token = reservation.reservation.token;
    let providerResponse: AiNaturalSearchProviderResponse;
    try {
      providerResponse = await this.provider.interpret(providerInput, config);
    } catch (error) {
      await safeRelease(this.aiPoints, token);
      return { status: 'FAILED', reason: errorCode(error, 'AI_PROVIDER_FAILED') };
    }

    const usage = usageFromProvider(config, providerResponse);
    let interpretation: { public: AiNaturalSearchInterpretation; terms: string[]; from: Date | null; to: Date | null };
    try {
      interpretation = normalizeInterpretation(providerResponse.interpretation);
    } catch (error) {
      if (!(await settleProviderSuccess(this.aiPoints, token, usage))) {
        return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
      }
      return { status: 'FAILED', reason: errorCode(error, 'AI_SEARCH_INTERPRETATION_INVALID') };
    }

    let records: AiNaturalSearchRecord[];
    try {
      records = await this.repository.searchRecords({ sourceId, terms: interpretation.terms, from: interpretation.from, to: interpretation.to, limit });
    } catch (error) {
      if (!(await settleProviderSuccess(this.aiPoints, token, usage))) {
        return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
      }
      return { status: 'FAILED', reason: errorCode(error, 'AI_SEARCH_RETRIEVAL_FAILED') };
    }

    const settled = await this.aiPoints.commitAiUsage(token, usage);
    if (settled.status !== 'COMMITTED') return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };

    return { status: 'RESULTS', entitlementSource: preliminary.source, interpretation: interpretation.public, records };
  }
}

function normalizeInterpretation(value: AiNaturalSearchInterpretation) {
  const terms = Array.from(new Set(value.terms.map((term) => requiredText(term, 100, 'AI_SEARCH_INTERPRETATION_INVALID')).filter(Boolean))).slice(0, 8);
  const from = optionalDate(value.from);
  const to = optionalDate(value.to);
  if (from && to && from.getTime() >= to.getTime()) throw new Error('AI_SEARCH_INTERPRETATION_INVALID');
  if (terms.length === 0 && !from && !to) throw new Error('AI_SEARCH_INTERPRETATION_EMPTY');
  return { public: { terms, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null }, terms, from, to };
}

function usageFromProvider(config: WorklogAiRuntimeConfigSnapshot, response: AiNaturalSearchProviderResponse): WorklogAiUsageCommit {
  return {
    operation: 'AI_NATURAL_SEARCH', workspaceId: null, recordId: null,
    ...snapshotAiUsage({
      provider: config.provider, model: config.model,
      inputUsdPerMillion: config.inputUsdPerMillion, outputUsdPerMillion: config.outputUsdPerMillion,
      audioUsdPerMillion: config.audioUsdPerMillion, imageUsdPerMillion: config.imageUsdPerMillion,
      usdTwdRate: config.usdTwdRate,
    }, { inputTokens: response.inputTokens, outputTokens: response.outputTokens, audioInputUnits: 0, imageInputUnits: 0 }),
  };
}

function blockedDecision(preliminary: AiEntitlementDecision, reservationStatus: string, entitlementReservationReason: string | null): AiEntitlementDecision {
  const reason = reservationStatus === 'AI_ENTITLEMENT_BLOCKED'
    ? entitlementReason(entitlementReservationReason ?? '')
    : preliminary.source === 'FREE_TRIAL' ? 'TRIAL_EXHAUSTED' : 'MONTHLY_POINT_CAP_REACHED';
  return { source: 'BLOCKED', allowed: false, reason, remainingPoints: reason === 'PER_REQUEST_POINT_CAP_EXCEEDED' ? preliminary.remainingPoints : 0, periodEndsAt: preliminary.periodEndsAt, perRequestAiPointCap: preliminary.perRequestAiPointCap };
}

async function settleProviderSuccess(aiPoints: AiPointLedgerPort, token: string, usage: WorklogAiUsageCommit): Promise<boolean> {
  try { return (await aiPoints.commitAiUsage(token, usage)).status === 'COMMITTED'; }
  catch { return false; }
}
async function safeRelease(aiPoints: AiPointLedgerPort, token: string) { try { await aiPoints.releaseAi(token); } catch {} }
function optionalDate(value: string | null): Date | null { if (value === null) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error('AI_SEARCH_INTERPRETATION_INVALID'); return date; }
function boundedLimit(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new Error('AI_SEARCH_LIMIT_INVALID'); return value; }
function validTimeZone(value: string): string { const normalized = value.trim(); if (!normalized || normalized.length > 64) throw new Error('AI_SEARCH_TIMEZONE_INVALID'); try { new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date(0)); } catch { throw new Error('AI_SEARCH_TIMEZONE_INVALID'); } return normalized; }
function requiredText(value: string, max: number, error: string): string { const normalized = value.trim().replace(/\s+/g, ' '); if (!normalized || normalized.length > max) throw new Error(error); return normalized; }
function positiveId(value: number, error: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error); return value; }
function validDate(value: Date): Date { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_REFERENCE_TIME'); return new Date(value.getTime()); }
function entitlementReason(value: string): AiEntitlementDecision['reason'] { const allowed: AiEntitlementDecision['reason'][] = ['SOURCE_NOT_AUTHORIZED','AI_NOT_ENTITLED','TRIAL_EXHAUSTED','MONTHLY_POINT_CAP_REACHED','MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED','MONTHLY_PROVIDER_COST_CAP_REACHED','PROVIDER_COST_ACCOUNTING_INCOMPLETE','AI_PRO_GRANT_NOT_READY','PER_REQUEST_POINT_CAP_EXCEEDED','PLAN_DISABLED']; return allowed.includes(value as AiEntitlementDecision['reason']) ? value as AiEntitlementDecision['reason'] : 'AI_NOT_ENTITLED'; }
function errorCode(error: unknown, fallback: string): string { if (error instanceof Error) { const candidate = 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code) : error.message; if (/^[A-Z0-9_]+$/.test(candidate)) return candidate; } return fallback; }
