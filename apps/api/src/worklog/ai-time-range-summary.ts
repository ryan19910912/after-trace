import type { AiEntitlementDecision } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { aiPointReservationCostHoldTwd } from './ai-points';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import { snapshotAiUsage } from './entitlements';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export type AiTimeRangeSummaryRecord = {
  id: number;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  title: string | null;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
};

export type AiTimeRangeSummaryProviderInput = {
  records: AiTimeRangeSummaryRecord[];
  from: string;
  to: string;
  timeZone: string;
};

export type AiTimeRangeSummaryProviderResponse = {
  summary: string;
  inputTokens: number;
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface AiTimeRangeSummaryProvider {
  reservationPoints(input: AiTimeRangeSummaryProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  summarize(input: AiTimeRangeSummaryProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<AiTimeRangeSummaryProviderResponse>;
}

export interface AiTimeRangeSummaryRepository {
  summaryEnabled(): Promise<boolean>;
  runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  recordsForRange(input: {
    sourceId: number;
    from: Date;
    to: Date;
    limit: number;
  }): Promise<AiTimeRangeSummaryRecord[]>;
}

export type AiTimeRangeSummaryEntitlementPort = {
  resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision>;
};

export type AiTimeRangeSummaryResult =
  | {
      status: 'SUMMARY';
      entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
      summary: string;
      recordCount: number;
      truncated: boolean;
      from: string;
      to: string;
    }
  | { status: 'NO_RECORDS'; from: string; to: string }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'DEFERRED'; reason: 'AI_RUNTIME_CONFIG_MISSING' }
  | { status: 'FAILED'; reason: string };

const MAX_RECORDS = 200;
/**
 * V1 provider request safety boundary. Record count alone is not a sufficient bound because
 * manual Records may each contain large text. Keep provider input comfortably below a huge
 * multi-megabyte prompt while still supporting useful weekly/monthly summaries.
 */
const MAX_PROVIDER_RECORD_CHARS = 120_000;

/**
 * Provider-backed time-range summary.
 *
 * Source authorization/entitlement and operator capability are checked before Record retrieval.
 * PostgreSQL deterministically selects a bounded exact-Source/time-range Record set; only that
 * bounded set is sent to the provider. The summary is transient product output and never mutates
 * durable Records.
 */
export class AiTimeRangeSummaryService {
  constructor(
    private readonly repository: AiTimeRangeSummaryRepository,
    private readonly entitlement: AiTimeRangeSummaryEntitlementPort,
    private readonly aiPoints: AiPointLedgerPort,
    private readonly provider: AiTimeRangeSummaryProvider,
  ) {}

  async summarize(input: {
    userId: number;
    sourceId: number;
    from: Date;
    to: Date;
    timeZone?: string;
    referenceAt?: Date;
  }): Promise<AiTimeRangeSummaryResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID');
    const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID');
    const referenceAt = validDate(input.referenceAt ?? new Date(), 'INVALID_REFERENCE_TIME');
    const from = validDate(input.from, 'AI_SUMMARY_FROM_INVALID');
    const to = validDate(input.to, 'AI_SUMMARY_TO_INVALID');
    if (from.getTime() >= to.getTime()) throw new Error('AI_SUMMARY_RANGE_INVALID');
    if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60_000) throw new Error('AI_SUMMARY_RANGE_TOO_LARGE');
    const timeZone = validTimeZone(input.timeZone ?? 'Asia/Taipei');

    const preliminary = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!preliminary.allowed || preliminary.source === 'BLOCKED') {
      return { status: 'BLOCKED', decision: preliminary };
    }
    if (!(await this.repository.summaryEnabled())) return { status: 'FAILED', reason: 'AI_TIME_RANGE_SUMMARY_DISABLED' };

    let fetched: AiTimeRangeSummaryRecord[];
    try {
      fetched = await this.repository.recordsForRange({ sourceId, from, to, limit: MAX_RECORDS + 1 });
    } catch (error) {
      return { status: 'FAILED', reason: errorCode(error, 'AI_SUMMARY_RETRIEVAL_FAILED') };
    }
    if (fetched.length === 0) return { status: 'NO_RECORDS', from: from.toISOString(), to: to.toISOString() };

    const bounded = boundedProviderRecords(fetched);
    const records = bounded.records;
    const truncated = fetched.length > MAX_RECORDS || bounded.truncated;
    const config = await this.repository.runtimeConfig();
    if (!config) return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };

    const providerInput: AiTimeRangeSummaryProviderInput = {
      records,
      from: from.toISOString(),
      to: to.toISOString(),
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
        decision: blockedDecision(
          preliminary,
          reservation.status,
          reservation.status === 'AI_ENTITLEMENT_BLOCKED' ? reservation.reason : null,
        ),
      };
    }

    const token = reservation.reservation.token;
    let response: AiTimeRangeSummaryProviderResponse;
    try {
      response = await this.provider.summarize(providerInput, config);
    } catch (error) {
      await safeRelease(this.aiPoints, token);
      return { status: 'FAILED', reason: errorCode(error, 'AI_PROVIDER_FAILED') };
    }

    const summary = response.summary.trim();
    const usage = usageFromProvider(config, response);
    if (!summary || summary.length > 12_000) {
      await settleProviderSuccess(this.aiPoints, token, usage);
      return { status: 'FAILED', reason: 'AI_SUMMARY_OUTPUT_INVALID' };
    }

    const settled = await this.aiPoints.commitAiUsage(token, usage);
    if (settled.status !== 'COMMITTED') return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };

    return {
      status: 'SUMMARY',
      entitlementSource: preliminary.source,
      summary,
      recordCount: records.length,
      truncated,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }
}

function boundedProviderRecords(fetched: AiTimeRangeSummaryRecord[]): {
  records: AiTimeRangeSummaryRecord[];
  truncated: boolean;
} {
  const candidates = fetched.slice(0, MAX_RECORDS);
  const records: AiTimeRangeSummaryRecord[] = [];
  let chars = 0;
  for (const record of candidates) {
    // Reserve a small fixed envelope for id/type/timestamps/JSON formatting in the provider prompt.
    const nextChars = record.rawText.length + (record.title?.length ?? 0) + 128;
    if (records.length > 0 && chars + nextChars > MAX_PROVIDER_RECORD_CHARS) break;
    records.push(record);
    chars += nextChars;
  }
  return { records, truncated: records.length < candidates.length };
}

function usageFromProvider(
  config: WorklogAiRuntimeConfigSnapshot,
  response: AiTimeRangeSummaryProviderResponse,
): WorklogAiUsageCommit {
  return {
    operation: 'AI_TIME_RANGE_SUMMARY',
    workspaceId: null,
    recordId: null,
    ...snapshotAiUsage({
      provider: config.provider,
      model: config.model,
      inputUsdPerMillion: config.inputUsdPerMillion,
      outputUsdPerMillion: config.outputUsdPerMillion,
      audioUsdPerMillion: config.audioUsdPerMillion,
      imageUsdPerMillion: config.imageUsdPerMillion,
      usdTwdRate: config.usdTwdRate,
    }, {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      audioInputUnits: 0,
      imageInputUnits: 0,
    }),
  };
}

function blockedDecision(preliminary: AiEntitlementDecision, reservationStatus: string, reservationReason: string | null): AiEntitlementDecision {
  const reason = reservationStatus === 'AI_ENTITLEMENT_BLOCKED'
    ? entitlementReason(reservationReason ?? '')
    : preliminary.source === 'FREE_TRIAL' ? 'TRIAL_EXHAUSTED' : 'MONTHLY_POINT_CAP_REACHED';
  return {
    source: 'BLOCKED', allowed: false, reason,
    remainingPoints: reason === 'PER_REQUEST_POINT_CAP_EXCEEDED' ? preliminary.remainingPoints : 0,
    periodEndsAt: preliminary.periodEndsAt,
    perRequestAiPointCap: preliminary.perRequestAiPointCap,
  };
}

async function settleProviderSuccess(aiPoints: AiPointLedgerPort, token: string, usage: WorklogAiUsageCommit) {
  try { await aiPoints.commitAiUsage(token, usage); } catch { /* durable diagnostics retain settlement failure */ }
}
async function safeRelease(aiPoints: AiPointLedgerPort, token: string) {
  try { await aiPoints.releaseAi(token); } catch { /* reservation expiry is fallback */ }
}
function positiveId(value: number, error: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
  return value;
}
function validDate(value: Date, error: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(error);
  return new Date(value.getTime());
}
function validTimeZone(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) throw new Error('AI_SUMMARY_TIMEZONE_INVALID');
  try { new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date(0)); }
  catch { throw new Error('AI_SUMMARY_TIMEZONE_INVALID'); }
  return normalized;
}
function entitlementReason(value: string): AiEntitlementDecision['reason'] {
  const allowed: AiEntitlementDecision['reason'][] = [
    'SOURCE_NOT_AUTHORIZED', 'AI_NOT_ENTITLED', 'TRIAL_EXHAUSTED', 'MONTHLY_POINT_CAP_REACHED',
    'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED', 'MONTHLY_PROVIDER_COST_CAP_REACHED',
    'PROVIDER_COST_ACCOUNTING_INCOMPLETE', 'AI_PRO_GRANT_NOT_READY', 'PER_REQUEST_POINT_CAP_EXCEEDED', 'PLAN_DISABLED',
  ];
  return allowed.includes(value as AiEntitlementDecision['reason']) ? value as AiEntitlementDecision['reason'] : 'AI_NOT_ENTITLED';
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
