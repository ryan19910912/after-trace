import type { AiEntitlementDecision } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { aiPointReservationCostHoldTwd } from './ai-points';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import { snapshotAiUsage } from './entitlements';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export type AiRewriteRecord = { id: number; sourceId: number; version: number; title: string | null; rawText: string; occurredAt: string | null };
export type AiRewriteProviderInput = { record: AiRewriteRecord; instruction: string };
export type AiRewriteProviderResponse = { proposedText: string; inputTokens: number; outputTokens: number; providerResponseId: string | null; latencyMs: number };
export interface AiRewriteProvider { reservationPoints(input: AiRewriteProviderInput, config: WorklogAiRuntimeConfigSnapshot): number; rewrite(input: AiRewriteProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<AiRewriteProviderResponse>; }
export interface AiRecordRewriteRepository { rewriteEnabled(): Promise<boolean>; runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>; recordForRewrite(sourceId: number, recordId: number): Promise<AiRewriteRecord | null>; }
export type AiRecordRewriteEntitlementPort = { resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision> };
export type AiRecordRewriteResult =
  | { status: 'PROPOSAL'; entitlementSource: 'AI_PRO'; recordId: number; expectedVersion: number; originalText: string; proposedText: string }
  | { status: 'NOT_FOUND'; reason: 'RECORD_NOT_FOUND' }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'DEFERRED'; reason: 'AI_RUNTIME_CONFIG_MISSING' }
  | { status: 'FAILED'; reason: string };

export class AiRecordRewriteService {
  constructor(private readonly repository: AiRecordRewriteRepository, private readonly entitlement: AiRecordRewriteEntitlementPort, private readonly aiPoints: AiPointLedgerPort, private readonly provider: AiRewriteProvider) {}
  async propose(input: { userId: number; sourceId: number; recordId: number; instruction: string; referenceAt?: Date }): Promise<AiRecordRewriteResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID'); const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID'); const recordId = positiveId(input.recordId, 'INVALID_RECORD_ID');
    const instruction = requiredText(input.instruction, 1000, 'AI_REWRITE_INSTRUCTION_REQUIRED'); const referenceAt = validDate(input.referenceAt ?? new Date());
    const preliminary = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!preliminary.allowed || preliminary.source === 'BLOCKED') return { status: 'BLOCKED', decision: preliminary };
    if (preliminary.source !== 'AI_PRO') return { status: 'BLOCKED', decision: aiProRequired(preliminary) };
    if (!(await this.repository.rewriteEnabled())) return { status: 'FAILED', reason: 'AI_REWRITE_DISABLED' };
    const record = await this.repository.recordForRewrite(sourceId, recordId); if (!record) return { status: 'NOT_FOUND', reason: 'RECORD_NOT_FOUND' };
    const config = await this.repository.runtimeConfig(); if (!config) return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };
    const providerInput = { record, instruction }; let requestedPoints: number; let providerCostHoldTwd: number | null;
    try { requestedPoints = positiveId(this.provider.reservationPoints(providerInput, config), 'AI_RESERVATION_ESTIMATE_INVALID'); providerCostHoldTwd = aiPointReservationCostHoldTwd({ points: requestedPoints, outputUsdPerMillion: config.outputUsdPerMillion, usdTwdRate: config.usdTwdRate }); }
    catch (error) { return { status: 'FAILED', reason: errorCode(error, 'AI_RESERVATION_ESTIMATE_INVALID') }; }
    const reservation = await this.aiPoints.reserveAi({ chargedUserId: userId, actorUserId: userId, sourceId, requestedPoints, providerCostHoldTwd, at: referenceAt, ttlMs: 10 * 60_000 });
    if (reservation.status !== 'RESERVED') return { status: 'BLOCKED', decision: blockedDecision(preliminary, reservation.status, reservation.status === 'AI_ENTITLEMENT_BLOCKED' ? reservation.reason : null) };
    const token = reservation.reservation.token; let response: AiRewriteProviderResponse;
    try { response = await this.provider.rewrite(providerInput, config); } catch (error) { await safeRelease(this.aiPoints, token); return { status: 'FAILED', reason: errorCode(error, 'AI_PROVIDER_FAILED') }; }
    const proposedText = response.proposedText.trim(); const usage = usageFromProvider(config, response, recordId);
    if (!proposedText || proposedText.length > 20_000) { if (!(await settleProviderSuccess(this.aiPoints, token, usage))) return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' }; return { status: 'FAILED', reason: 'AI_REWRITE_OUTPUT_INVALID' }; }
    if ((await this.aiPoints.commitAiUsage(token, usage)).status !== 'COMMITTED') return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
    return { status: 'PROPOSAL', entitlementSource: 'AI_PRO', recordId, expectedVersion: record.version, originalText: record.rawText, proposedText };
  }
}
function aiProRequired(value: AiEntitlementDecision): AiEntitlementDecision { return { ...value, source: 'BLOCKED', allowed: false, reason: 'AI_NOT_ENTITLED' }; }
function usageFromProvider(config: WorklogAiRuntimeConfigSnapshot, response: AiRewriteProviderResponse, recordId: number): WorklogAiUsageCommit { return { operation: 'AI_RECORD_REWRITE_PROPOSAL', workspaceId: null, recordId, ...snapshotAiUsage({ provider: config.provider, model: config.model, inputUsdPerMillion: config.inputUsdPerMillion, outputUsdPerMillion: config.outputUsdPerMillion, audioUsdPerMillion: config.audioUsdPerMillion, imageUsdPerMillion: config.imageUsdPerMillion, usdTwdRate: config.usdTwdRate }, { inputTokens: response.inputTokens, outputTokens: response.outputTokens, audioInputUnits: 0, imageInputUnits: 0 }) }; }
function blockedDecision(preliminary: AiEntitlementDecision, status: string, reservationReason: string | null): AiEntitlementDecision { const reason = status === 'AI_ENTITLEMENT_BLOCKED' ? entitlementReason(reservationReason ?? '') : 'MONTHLY_POINT_CAP_REACHED'; return { source: 'BLOCKED', allowed: false, reason, remainingPoints: reason === 'PER_REQUEST_POINT_CAP_EXCEEDED' ? preliminary.remainingPoints : 0, periodEndsAt: preliminary.periodEndsAt, perRequestAiPointCap: preliminary.perRequestAiPointCap }; }
async function settleProviderSuccess(aiPoints: AiPointLedgerPort, token: string, usage: WorklogAiUsageCommit): Promise<boolean> { try { return (await aiPoints.commitAiUsage(token, usage)).status === 'COMMITTED'; } catch { return false; } }
async function safeRelease(aiPoints: AiPointLedgerPort, token: string) { try { await aiPoints.releaseAi(token); } catch {} }
function requiredText(value: string, max: number, error: string): string { const normalized = value.trim().replace(/\s+/g, ' '); if (!normalized || normalized.length > max) throw new Error(error); return normalized; }
function positiveId(value: number, error: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error); return value; }
function validDate(value: Date): Date { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_REFERENCE_TIME'); return new Date(value.getTime()); }
function entitlementReason(value: string): AiEntitlementDecision['reason'] { const allowed: AiEntitlementDecision['reason'][] = ['SOURCE_NOT_AUTHORIZED','AI_NOT_ENTITLED','TRIAL_EXHAUSTED','MONTHLY_POINT_CAP_REACHED','MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED','MONTHLY_PROVIDER_COST_CAP_REACHED','PROVIDER_COST_ACCOUNTING_INCOMPLETE','AI_PRO_GRANT_NOT_READY','PER_REQUEST_POINT_CAP_EXCEEDED','PLAN_DISABLED']; return allowed.includes(value as AiEntitlementDecision['reason']) ? value as AiEntitlementDecision['reason'] : 'AI_NOT_ENTITLED'; }
function errorCode(error: unknown, fallback: string): string { if (error instanceof Error) { const candidate = 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code) : error.message; if (/^[A-Z0-9_]+$/.test(candidate)) return candidate; } return fallback; }
