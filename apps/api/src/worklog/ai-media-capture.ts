import type { AiEntitlementDecision } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import { aiPointReservationCostHoldTwd } from './ai-points';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import { snapshotAiUsage } from './entitlements';
import type { RecordCaptureContext } from './record-capture-context';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export type AiMediaInputType = 'AUDIO' | 'IMAGE' | 'FILE';
export type AiMediaProviderContent = { mimeType: string; byteLength: number; dataBase64: string };
export type AiMediaProviderOutput = { inputType: AiMediaInputType; rawText: string; attachmentMetadata: Record<string, unknown> };
export type AiMediaProviderResponse = { output: AiMediaProviderOutput; inputTokens: number; outputTokens: number; audioInputUnits: number; imageInputUnits: number; providerResponseId: string | null; latencyMs: number };
export interface AiMediaProvider {
  reservationPoints(content: AiMediaProviderContent, config: WorklogAiRuntimeConfigSnapshot): number;
  analyze(content: AiMediaProviderContent, config: WorklogAiRuntimeConfigSnapshot, instruction?: string | null): Promise<AiMediaProviderResponse>;
}

export type AiMediaCaptureRecord = { id: number; sourceId: number; authorUserId: number; inputType: AiMediaInputType; rawText: string; captureContext: RecordCaptureContext | null; createdAt: string };
export type AiMediaPlanLimits = {
  enabled: boolean;
  maxImagesPerRequest: number;
  maxImageBytes: number;
  maxAudioSeconds: number;
  maxAudioBytes: number;
  maxFileBytes: number;
};
export type AiMediaCaptureRepository = {
  mediaPlan(userId: number): Promise<AiMediaPlanLimits | null>;
  runtimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  createMediaRecord(input: { userId: number; sourceId: number; inputType: AiMediaInputType; rawText: string; attachmentMetadata: Record<string, unknown>; captureContext: RecordCaptureContext | null; enrichedAt: Date }): Promise<{ record: AiMediaCaptureRecord; workspaceId: number | null }>;
};
export type AiMediaCaptureEntitlementPort = { resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision> };
export type AiImageInput = { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; byteLength: number; dataBase64: string };
export type AiAudioInput = { mimeType: 'audio/webm' | 'audio/ogg' | 'audio/mpeg' | 'audio/mp4' | 'audio/wav' | 'audio/x-wav'; byteLength: number; dataBase64: string };
export type AiFileInput = { mimeType: 'application/pdf' | 'application/json' | 'application/xml' | 'text/plain' | 'text/markdown' | 'text/csv' | 'text/xml'; byteLength: number; dataBase64: string };
export type AiMediaCaptureResult =
  | { status: 'CREATED'; entitlementSource: 'AI_PRO'; record: AiMediaCaptureRecord }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'DEFERRED'; reason: 'AI_RUNTIME_CONFIG_MISSING' }
  | { status: 'FAILED'; reason: string };

const HARD_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const HARD_MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 30 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AUDIO_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav']);
const FILE_MIME_TYPES = new Set(['application/pdf', 'application/json', 'application/xml', 'text/plain', 'text/markdown', 'text/csv', 'text/xml']);

export class AiMediaCaptureService {
  constructor(private readonly repository: AiMediaCaptureRepository, private readonly entitlement: AiMediaCaptureEntitlementPort, private readonly aiPoints: AiPointLedgerPort, private readonly provider: AiMediaProvider) {}

  captureImage(input: { userId: number; sourceId: number; image: AiImageInput; captureContext: RecordCaptureContext | null; instruction?: string | null; referenceAt?: Date }): Promise<AiMediaCaptureResult> {
    return this.capture({ userId: input.userId, sourceId: input.sourceId, inputType: 'IMAGE', media: input.image, captureContext: input.captureContext, instruction: input.instruction, referenceAt: input.referenceAt });
  }
  captureAudio(input: { userId: number; sourceId: number; audio: AiAudioInput; durationSeconds?: number | null; instruction?: string | null; referenceAt?: Date }): Promise<AiMediaCaptureResult> {
    return this.capture({ userId: input.userId, sourceId: input.sourceId, inputType: 'AUDIO', media: input.audio, audioDurationSeconds: input.durationSeconds, captureContext: null, instruction: input.instruction, referenceAt: input.referenceAt });
  }
  captureFile(input: { userId: number; sourceId: number; file: AiFileInput; instruction?: string | null; referenceAt?: Date }): Promise<AiMediaCaptureResult> {
    return this.capture({ userId: input.userId, sourceId: input.sourceId, inputType: 'FILE', media: input.file, captureContext: null, instruction: input.instruction, referenceAt: input.referenceAt });
  }

  private async capture(input: { userId: number; sourceId: number; inputType: AiMediaInputType; media: AiMediaProviderContent; audioDurationSeconds?: number | null; captureContext: RecordCaptureContext | null; instruction?: string | null; referenceAt?: Date }): Promise<AiMediaCaptureResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID');
    const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID');
    const referenceAt = validDate(input.referenceAt ?? new Date());
    const media = validateHardMedia(input.inputType, input.media);

    const preliminary = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!preliminary.allowed || preliminary.source === 'BLOCKED') return { status: 'BLOCKED', decision: preliminary };
    if (preliminary.source !== 'AI_PRO') return { status: 'FAILED', reason: 'AI_PRO_MEDIA_REQUIRED' };

    const plan = await this.repository.mediaPlan(userId);
    if (!plan?.enabled) return { status: 'FAILED', reason: 'AI_MEDIA_DISABLED' };
    const planError = validatePlanLimits(input.inputType, media, input.audioDurationSeconds, plan);
    if (planError) return { status: 'FAILED', reason: planError };

    const config = await this.repository.runtimeConfig();
    if (!config) return { status: 'DEFERRED', reason: 'AI_RUNTIME_CONFIG_MISSING' };

    let requestedPoints: number;
    let providerCostHoldTwd: number | null;
    try {
      requestedPoints = positiveId(this.provider.reservationPoints(media, config), 'AI_RESERVATION_ESTIMATE_INVALID');
      providerCostHoldTwd = aiPointReservationCostHoldTwd({ points: requestedPoints, outputUsdPerMillion: config.outputUsdPerMillion, usdTwdRate: config.usdTwdRate });
    } catch (error) { return { status: 'FAILED', reason: errorCode(error, 'AI_RESERVATION_ESTIMATE_INVALID') }; }

    const reservation = await this.aiPoints.reserveAi({ chargedUserId: userId, actorUserId: userId, sourceId, requestedPoints, providerCostHoldTwd, at: referenceAt, ttlMs: 10 * 60_000 });
    if (reservation.status !== 'RESERVED') {
      return { status: 'BLOCKED', decision: blockedDecision(preliminary, reservation.status, reservation.status === 'AI_ENTITLEMENT_BLOCKED' ? reservation.reason : null) };
    }

    const token = reservation.reservation.token;
    let providerResponse: AiMediaProviderResponse;
    try { providerResponse = await this.provider.analyze(media, config, boundedInstruction(input.instruction)); }
    catch (error) { await safeRelease(this.aiPoints, token); return { status: 'FAILED', reason: errorCode(error, 'AI_PROVIDER_FAILED') }; }

    const operation = `${input.inputType}_RECORD_CREATE`;
    const usage = usageFromProvider(config, providerResponse, operation);
    if (providerResponse.output.inputType !== input.inputType) {
      if (!(await settleProviderSuccess(this.aiPoints, token, usage))) return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
      return { status: 'FAILED', reason: `AI_${input.inputType}_PROVIDER_TYPE_MISMATCH` };
    }

    let created: { record: AiMediaCaptureRecord; workspaceId: number | null };
    try {
      created = await this.repository.createMediaRecord({ userId, sourceId, inputType: input.inputType, rawText: providerResponse.output.rawText, attachmentMetadata: { ...providerResponse.output.attachmentMetadata, source: `PRODUCT_INLINE_${input.inputType}`, originalStored: false }, captureContext: input.captureContext, enrichedAt: new Date() });
    } catch (error) {
      if (!(await settleProviderSuccess(this.aiPoints, token, usage))) return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
      return { status: 'FAILED', reason: errorCode(error, 'AI_RECORD_CREATE_FAILED') };
    }

    const settled = await this.aiPoints.commitAiUsage(token, { ...usage, workspaceId: created.workspaceId, recordId: created.record.id });
    if (settled.status !== 'COMMITTED') return { status: 'FAILED', reason: 'AI_USAGE_SETTLEMENT_FAILED' };
    return { status: 'CREATED', entitlementSource: 'AI_PRO', record: created.record };
  }
}

function validateHardMedia(inputType: AiMediaInputType, media: AiMediaProviderContent): AiMediaProviderContent {
  const mimeType = media.mimeType.trim().toLowerCase();
  const rule = inputType === 'IMAGE' ? { allowed: IMAGE_MIME_TYPES, maxBytes: HARD_MAX_IMAGE_BYTES, typeError: 'AI_IMAGE_TYPE_UNSUPPORTED', sizeError: 'AI_IMAGE_TOO_LARGE' } : inputType === 'AUDIO' ? { allowed: AUDIO_MIME_TYPES, maxBytes: HARD_MAX_AUDIO_BYTES, typeError: 'AI_AUDIO_TYPE_UNSUPPORTED', sizeError: 'AI_AUDIO_TOO_LARGE' } : { allowed: FILE_MIME_TYPES, maxBytes: HARD_MAX_FILE_BYTES, typeError: 'AI_FILE_TYPE_UNSUPPORTED', sizeError: 'AI_FILE_TOO_LARGE' };
  if (!rule.allowed.has(mimeType)) throw new Error(rule.typeError);
  if (!Number.isSafeInteger(media.byteLength) || media.byteLength <= 0 || media.byteLength > rule.maxBytes) throw new Error(rule.sizeError);
  if (!media.dataBase64 || media.dataBase64.length > Math.ceil(media.byteLength * 4 / 3) + 8) throw new Error(`AI_${inputType}_BASE64_INVALID`);
  return { mimeType, byteLength: media.byteLength, dataBase64: media.dataBase64 };
}
function validatePlanLimits(inputType: AiMediaInputType, media: AiMediaProviderContent, durationSeconds: number | null | undefined, plan: AiMediaPlanLimits): string | null {
  if (inputType === 'IMAGE' && media.byteLength > plan.maxImageBytes) return 'AI_IMAGE_TOO_LARGE';
  if (inputType === 'AUDIO' && media.byteLength > plan.maxAudioBytes) return 'AI_AUDIO_TOO_LARGE';
  if (inputType === 'AUDIO' && durationSeconds != null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > plan.maxAudioSeconds)) return 'AI_AUDIO_DURATION_TOO_LONG';
  if (inputType === 'FILE' && media.byteLength > plan.maxFileBytes) return 'AI_FILE_TOO_LARGE';
  return null;
}
function usageFromProvider(config: WorklogAiRuntimeConfigSnapshot, response: AiMediaProviderResponse, operation: string): WorklogAiUsageCommit { return { operation, workspaceId: null, recordId: null, ...snapshotAiUsage({ provider: config.provider, model: config.model, inputUsdPerMillion: config.inputUsdPerMillion, outputUsdPerMillion: config.outputUsdPerMillion, audioUsdPerMillion: config.audioUsdPerMillion, imageUsdPerMillion: config.imageUsdPerMillion, usdTwdRate: config.usdTwdRate }, { inputTokens: response.inputTokens, outputTokens: response.outputTokens, audioInputUnits: response.audioInputUnits, imageInputUnits: response.imageInputUnits }) }; }
function blockedDecision(preliminary: AiEntitlementDecision, reservationStatus: string, entitlementReservationReason: string | null): AiEntitlementDecision { const reason = reservationStatus === 'AI_ENTITLEMENT_BLOCKED' ? entitlementReason(entitlementReservationReason ?? '') : 'MONTHLY_POINT_CAP_REACHED'; return { source: 'BLOCKED', allowed: false, reason, remainingPoints: reason === 'PER_REQUEST_POINT_CAP_EXCEEDED' ? preliminary.remainingPoints : 0, periodEndsAt: preliminary.periodEndsAt, perRequestAiPointCap: preliminary.perRequestAiPointCap }; }
function boundedInstruction(value: string | null | undefined): string | null { if (!value?.trim()) return null; return value.trim().slice(0, 1000); }
async function settleProviderSuccess(aiPoints: AiPointLedgerPort, token: string, usage: WorklogAiUsageCommit): Promise<boolean> { try { return (await aiPoints.commitAiUsage(token, usage)).status === 'COMMITTED'; } catch { return false; } }
async function safeRelease(aiPoints: AiPointLedgerPort, token: string): Promise<void> { try { await aiPoints.releaseAi(token); } catch {} }
function positiveId(value: number, error: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error); return value; }
function validDate(value: Date): Date { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_REFERENCE_TIME'); return new Date(value.getTime()); }
function entitlementReason(value: string): AiEntitlementDecision['reason'] { const allowed: AiEntitlementDecision['reason'][] = ['SOURCE_NOT_AUTHORIZED','AI_NOT_ENTITLED','TRIAL_EXHAUSTED','MONTHLY_POINT_CAP_REACHED','MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED','MONTHLY_PROVIDER_COST_CAP_REACHED','PROVIDER_COST_ACCOUNTING_INCOMPLETE','AI_PRO_GRANT_NOT_READY','PER_REQUEST_POINT_CAP_EXCEEDED','PLAN_DISABLED']; return allowed.includes(value as AiEntitlementDecision['reason']) ? value as AiEntitlementDecision['reason'] : 'AI_NOT_ENTITLED'; }
function errorCode(error: unknown, fallback: string): string { if (error instanceof Error) { const candidate = 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code) : error.message; if (/^[A-Z0-9_]+$/.test(candidate)) return candidate; } return fallback; }
