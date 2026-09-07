import type { AiEntitlementDecision } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { aiPointReservationCostHoldTwd } from './ai-points';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import { snapshotAiUsage } from './entitlements';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export type AiTaskProposalRecord = {
  id: number;
  sourceId: number;
  title: string | null;
  rawText: string;
  occurredAt: string | null;
};

export type AiTaskProposalProviderInput = {
  text: string;
  record: AiTaskProposalRecord | null;
  referenceAt: Date;
  timeZone: string;
};

export type AiTaskProposalProviderResponse = {
  title: string;
  body: string | null;
  dueAt: string | null;
  remindAt: string | null;
  inputTokens: number;
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface AiTaskProposalProvider {
  reservationPoints(input: AiTaskProposalProviderInput, config: WorklogAiRuntimeConfigSnapshot): number;
  propose(input: AiTaskProposalProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<AiTaskProposalProviderResponse>;
}

export interface AiTaskProposalRepository {
  taskProposalEnabled(): Promise<boolean>;
  runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  recordContext(sourceId: number, recordId: number): Promise<AiTaskProposalRecord | null>;
}

export type AiTaskProposalEntitlementPort = {
  resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision>;
};

export type AiTaskProposalResult =
  | {
      status: 'PROPOSAL';
      entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
      sourceId: number;
      recordId: number | null;
      title: string;
      body: string | null;
      dueAt: string | null;
      remindAt: string | null;
    }
  | { status: 'NOT_FOUND'; reason: 'RECORD_NOT_FOUND' }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'DEFERRED'; reason: 'AI_RUNTIME_CONFIG_MISSING' }
  | { status: 'FAILED'; reason: string };

/**
 * Provider-backed Task interpretation is proposal-only. This service never creates a Task.
 * The client must show the proposal and explicitly POST it to the normal Task API after user confirmation.
 */
export class AiTaskProposalService {
  constructor(
    private readonly repository: AiTaskProposalRepository,
    private readonly entitlement: AiTaskProposalEntitlementPort,
    private readonly aiPoints: AiPointLedgerPort,
    private readonly provider: AiTaskProposalProvider,
  ) {}

  async propose(input: {
    userId: number;
    sourceId: number;
    recordId?: number | null;
    text: string;
    timeZone: string;
    referenceAt?: Date;
  }): Promise<AiTaskProposalResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID');
    const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID');
    const recordId = input.recordId == null ? null : positiveId(input.recordId, 'INVALID_RECORD_ID');
    const text = requiredText(input.text, 5000, 'AI_TASK_TEXT_REQUIRED');
    const timeZone = validTimeZone(input.timeZone);
    const referenceAt = validDate(input.referenceAt ?? new Date());

    const preliminary = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!preliminary.allowed || preliminary.source === 'BLOCKED') return { status: 'BLOCKED', decision: preliminary };
    if (!(await this.repository.taskProposalEnabled())) return { status: 'FAILED', reason: 'AI_TASK_PROPOSAL_DISABLED' };

    const record = recordId === null ? null : await this.repository.recordContext(sourceId, recordId);
    if (recordId !== null && !record) return { status: 'NOT_FOUND', reason: 'RECORD_NOT_FOUND' };

    const config = await this.repository.runtimeConfig();
    if (!config) return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };
    const providerInput: AiTaskProposalProviderInput = { text, record, referenceAt, timeZone };

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
    let response: AiTaskProposalProviderResponse;
    try {
      response = await this.provider.propose(providerInput, config);
    } catch (error) {
      await safeRelease(this.aiPoints, token);
      return { status: 'FAILED', reason: errorCode(error, 'AI_PROVIDER_FAILED') };
    }

    const normalized = normalizeProposal(response);
    const usage = usageFromProvider(config, response, recordId);
    if (!normalized) {
      await settleProviderSuccess(this.aiPoints, token, usage);
      return { status: 'FAILED', reason: 'AI_TASK_PROPOSAL_OUTPUT_INVALID' };
    }
    const settled = await this.aiPoints.commitAiUsage(token, usage);
    if (settled.status !== 'COMMITTED') return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };

    return {
      status: 'PROPOSAL',
      entitlementSource: preliminary.source,
      sourceId,
      recordId,
      ...normalized,
    };
  }
}

function normalizeProposal(response: AiTaskProposalProviderResponse) {
  const title = response.title.trim();
  const body = response.body?.trim() || null;
  if (!title || title.length > 255 || (body?.length ?? 0) > 10_000) return null;
  const dueAt = normalizedIsoOrNull(response.dueAt);
  const remindAt = normalizedIsoOrNull(response.remindAt);
  if (response.dueAt && !dueAt) return null;
  if (response.remindAt && !remindAt) return null;
  return { title, body, dueAt, remindAt };
}

function usageFromProvider(config: WorklogAiRuntimeConfigSnapshot, response: AiTaskProposalProviderResponse, recordId: number | null): WorklogAiUsageCommit {
  return {
    operation: 'AI_TASK_PROPOSAL',
    workspaceId: null,
    recordId,
    ...snapshotAiUsage({
      provider: config.provider,
      model: config.model,
      inputUsdPerMillion: config.inputUsdPerMillion,
      outputUsdPerMillion: config.outputUsdPerMillion,
      audioUsdPerMillion: config.audioUsdPerMillion,
      imageUsdPerMillion: config.imageUsdPerMillion,
      usdTwdRate: config.usdTwdRate,
    }, { inputTokens: response.inputTokens, outputTokens: response.outputTokens, audioInputUnits: 0, imageInputUnits: 0 }),
  };
}

function blockedDecision(preliminary: AiEntitlementDecision, status: string, reservationReason: string | null): AiEntitlementDecision {
  const reason = status === 'AI_ENTITLEMENT_BLOCKED'
    ? entitlementReason(reservationReason ?? '')
    : preliminary.source === 'FREE_TRIAL' ? 'TRIAL_EXHAUSTED' : 'MONTHLY_POINT_CAP_REACHED';
  return {
    source: 'BLOCKED', allowed: false, reason,
    remainingPoints: reason === 'PER_REQUEST_POINT_CAP_EXCEEDED' ? preliminary.remainingPoints : 0,
    periodEndsAt: preliminary.periodEndsAt,
    perRequestAiPointCap: preliminary.perRequestAiPointCap,
  };
}
async function settleProviderSuccess(aiPoints: AiPointLedgerPort, token: string, usage: WorklogAiUsageCommit) { try { await aiPoints.commitAiUsage(token, usage); } catch { /* retained for diagnostics */ } }
async function safeRelease(aiPoints: AiPointLedgerPort, token: string) { try { await aiPoints.releaseAi(token); } catch { /* expiry fallback */ } }
function requiredText(value: string, max: number, error: string) { const normalized = value.trim(); if (!normalized || normalized.length > max) throw new Error(error); return normalized; }
function positiveId(value: number, error: string) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error); return value; }
function validDate(value: Date) { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_REFERENCE_TIME'); return new Date(value.getTime()); }
function validTimeZone(value: string) { const normalized = value.trim(); if (!normalized || normalized.length > 100) throw new Error('AI_TASK_TIMEZONE_INVALID'); try { new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date()); } catch { throw new Error('AI_TASK_TIMEZONE_INVALID'); } return normalized; }
function normalizedIsoOrNull(value: string | null) { if (value == null || value === '') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function entitlementReason(value: string): AiEntitlementDecision['reason'] { const allowed: AiEntitlementDecision['reason'][] = ['SOURCE_NOT_AUTHORIZED','AI_NOT_ENTITLED','TRIAL_EXHAUSTED','MONTHLY_POINT_CAP_REACHED','MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED','MONTHLY_PROVIDER_COST_CAP_REACHED','PROVIDER_COST_ACCOUNTING_INCOMPLETE','AI_PRO_GRANT_NOT_READY','PER_REQUEST_POINT_CAP_EXCEEDED','PLAN_DISABLED']; return allowed.includes(value as AiEntitlementDecision['reason']) ? value as AiEntitlementDecision['reason'] : 'AI_NOT_ENTITLED'; }
function errorCode(error: unknown, fallback: string) { if (error instanceof Error) { const candidate = 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code) : error.message; if (/^[A-Z0-9_]+$/.test(candidate)) return candidate; } return fallback; }
