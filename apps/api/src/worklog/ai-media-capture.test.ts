import { describe, expect, it } from 'vitest';
import {
  AiMediaCaptureService,
  type AiMediaCaptureRepository,
  type AiMediaInputType,
  type AiMediaProvider,
} from './ai-media-capture';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';

const config = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
  audioUsdPerMillion: 1.5, imageUsdPerMillion: 3, usdTwdRate: 32,
};

function repository(calls: string[], mediaEnabled = true): AiMediaCaptureRepository {
  return {
    async mediaEnabled() { calls.push('media-capability'); return mediaEnabled; },
    async runtimeConfig() { calls.push('runtime'); return config; },
    async createMediaRecord(input) {
      calls.push(`create-record:${input.inputType}`);
      return {
        workspaceId: 3,
        record: {
          id: 99, sourceId: input.sourceId, authorUserId: input.userId, inputType: input.inputType,
          rawText: input.rawText, captureContext: input.captureContext, createdAt: '2026-09-07T12:00:00.000Z',
        },
      };
    },
  };
}

function provider(calls: string[], inputType: AiMediaInputType): AiMediaProvider {
  return {
    reservationPoints() { calls.push(`estimate:${inputType}`); return 25; },
    async analyze() {
      calls.push(`provider:${inputType}`);
      return {
        output: {
          inputType,
          rawText: inputType === 'AUDIO'
            ? '今天完成晴空案巡檢。'
            : inputType === 'FILE'
              ? '文件內容：晴空案驗收完成。'
              : '畫面顯示 AFTERTRACE 測試頁。',
          attachmentMetadata: {},
        },
        inputTokens: 20,
        outputTokens: 8,
        audioInputUnits: inputType === 'AUDIO' ? 12 : 0,
        imageInputUnits: inputType === 'IMAGE' ? 12 : 0,
        providerResponseId: `${inputType.toLowerCase()}-response`,
        latencyMs: 10,
      };
    },
  };
}

function ledger(calls: string[], blocked = false): AiPointLedgerPort {
  return {
    async reserveAi(input) {
      calls.push(`reserve:${input.providerCostHoldTwd === null ? 'no-hold' : 'hold'}`);
      if (blocked) return { status: 'AI_ENTITLEMENT_BLOCKED', reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' } as const;
      return {
        status: 'RESERVED',
        reservation: {
          id: 1, token: 'media-token', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 5, pointsReserved: 25, pointsCommitted: 0, platformSubsidizedPoints: 0,
          providerCostHoldTwd: input.providerCostHoldTwd, status: 'RESERVED', expiresAt: new Date('2026-09-07T13:00:00.000Z'),
        },
        remainingAiPoints: 75,
      };
    },
    async commitAiUsage(_token, usage) {
      calls.push(`commit:${usage.operation}:${usage.recordId ?? 'none'}:${usage.audioInputUnits}:${usage.imageInputUnits}`);
      return {
        status: 'COMMITTED', actualPoints: 18,
        reservation: {
          id: 1, token: 'media-token', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 5, pointsReserved: 25, pointsCommitted: 18, platformSubsidizedPoints: 0,
          providerCostHoldTwd: 0.0016, status: 'COMMITTED', expiresAt: new Date('2026-09-07T13:00:00.000Z'),
        },
      };
    },
    async releaseAi() { calls.push('release'); return { status: 'RESERVATION_NOT_FOUND' }; },
  };
}

const image = { mimeType: 'image/png' as const, byteLength: 3, dataBase64: 'YWJj' };
const audio = { mimeType: 'audio/webm' as const, byteLength: 3, dataBase64: 'YWJj' };
const file = { mimeType: 'application/pdf' as const, byteLength: 3, dataBase64: 'YWJj' };

function entitled(source: 'FREE_TRIAL' | 'AI_PRO' = 'FREE_TRIAL') {
  return {
    async resolve() {
      return source === 'FREE_TRIAL'
        ? { source, allowed: true as const, reason: 'FREE_TRIAL_AVAILABLE' as const, remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100 }
        : { source, allowed: true as const, reason: 'AI_PRO_AVAILABLE' as const, remainingPoints: 100, periodEndsAt: '2026-10-07T00:00:00.000Z', perRequestAiPointCap: 100 };
    },
  };
}

describe('AiMediaCaptureService', () => {
  it('blocks before capability/runtime/provider when source or entitlement is unavailable', async () => {
    const calls: string[] = [];
    const service = new AiMediaCaptureService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return { source: 'BLOCKED', allowed: false, reason: 'TRIAL_EXHAUSTED', remainingPoints: 0, periodEndsAt: null, perRequestAiPointCap: null };
      },
    }, ledger(calls), provider(calls, 'IMAGE'));

    expect(await service.captureImage({ userId: 7, sourceId: 12, image, captureContext: null })).toMatchObject({
      status: 'BLOCKED', decision: { reason: 'TRIAL_EXHAUSTED' },
    });
    expect(calls).toEqual(['resolve']);
  });

  it('fails before runtime/reservation/provider when operator disables AI media', async () => {
    const calls: string[] = [];
    const service = new AiMediaCaptureService(repository(calls, false), entitled('AI_PRO'), ledger(calls), provider(calls, 'AUDIO'));

    expect(await service.captureAudio({ userId: 7, sourceId: 12, audio })).toEqual({
      status: 'FAILED', reason: 'AI_MEDIA_DISABLED',
    });
    expect(calls).toEqual(['media-capability']);
  });

  it('reserves provider-cost hold, analyzes image, persists Record and settles actual image usage', async () => {
    const calls: string[] = [];
    const service = new AiMediaCaptureService(repository(calls), entitled(), ledger(calls), provider(calls, 'IMAGE'));

    const result = await service.captureImage({
      userId: 7, sourceId: 12, image,
      captureContext: { client: 'CHROME_EXTENSION', page: { title: 'Example', url: 'https://example.test/' } },
    });

    expect(result).toMatchObject({ status: 'CREATED', entitlementSource: 'FREE_TRIAL', record: { id: 99, inputType: 'IMAGE' } });
    expect(calls).toEqual([
      'media-capability', 'runtime', 'estimate:IMAGE', 'reserve:hold', 'provider:IMAGE',
      'create-record:IMAGE', 'commit:IMAGE_RECORD_CREATE:99:0:12',
    ]);
  });

  it('uses the same entitlement and actual modality accounting for AI voice capture', async () => {
    const calls: string[] = [];
    const service = new AiMediaCaptureService(repository(calls), entitled(), ledger(calls), provider(calls, 'AUDIO'));

    const result = await service.captureAudio({ userId: 7, sourceId: 12, audio });

    expect(result).toMatchObject({ status: 'CREATED', entitlementSource: 'FREE_TRIAL', record: { inputType: 'AUDIO' } });
    expect(calls).toEqual([
      'media-capability', 'runtime', 'estimate:AUDIO', 'reserve:hold', 'provider:AUDIO',
      'create-record:AUDIO', 'commit:AUDIO_RECORD_CREATE:99:12:0',
    ]);
  });

  it('uses the same entitlement path for bounded PDF/file interpretation', async () => {
    const calls: string[] = [];
    const service = new AiMediaCaptureService(repository(calls), entitled('AI_PRO'), ledger(calls), provider(calls, 'FILE'));

    const result = await service.captureFile({ userId: 7, sourceId: 12, file });

    expect(result).toMatchObject({ status: 'CREATED', entitlementSource: 'AI_PRO', record: { inputType: 'FILE' } });
    expect(calls).toEqual([
      'media-capability', 'runtime', 'estimate:FILE', 'reserve:hold', 'provider:FILE',
      'create-record:FILE', 'commit:FILE_RECORD_CREATE:99:0:0',
    ]);
  });

  it('fails closed on the AI Pro provider-cost cap before provider execution', async () => {
    const calls: string[] = [];
    const service = new AiMediaCaptureService(repository(calls), entitled('AI_PRO'), ledger(calls, true), provider(calls, 'FILE'));

    expect(await service.captureFile({ userId: 7, sourceId: 12, file })).toMatchObject({
      status: 'BLOCKED', decision: { reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' },
    });
    expect(calls).toEqual(['media-capability', 'runtime', 'estimate:FILE', 'reserve:hold']);
  });
});