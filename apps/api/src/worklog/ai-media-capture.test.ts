import { describe, expect, it } from 'vitest';
import { AiMediaCaptureService, type AiMediaCaptureRepository } from './ai-media-capture';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import type { WorklogAttachmentProvider } from './attachment-ingestion';

const config = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
  audioUsdPerMillion: 1.5, imageUsdPerMillion: 3, usdTwdRate: 32,
};

function repository(calls: string[]): AiMediaCaptureRepository {
  return {
    async runtimeConfig() { calls.push('runtime'); return config; },
    async createImageRecord(input) {
      calls.push('create-record');
      return {
        workspaceId: 3,
        record: {
          id: 99, sourceId: input.sourceId, authorUserId: input.userId, inputType: 'IMAGE',
          rawText: input.rawText, captureContext: input.captureContext, createdAt: '2026-09-07T12:00:00.000Z',
        },
      };
    },
  };
}

function provider(calls: string[]): WorklogAttachmentProvider {
  return {
    reservationPoints() { calls.push('estimate'); return 25; },
    async analyze() {
      calls.push('provider');
      return {
        output: { inputType: 'IMAGE', rawText: '畫面顯示 AFTERTRACE 測試頁。', attachmentMetadata: {} },
        inputTokens: 20, outputTokens: 8, audioInputUnits: 0, imageInputUnits: 12,
        providerResponseId: 'image-response', latencyMs: 10,
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
      calls.push(`commit:${usage.operation}:${usage.recordId ?? 'none'}:${usage.imageInputUnits}`);
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

it('blocks before runtime/provider when source or entitlement is unavailable', async () => {
  const calls: string[] = [];
  const service = new AiMediaCaptureService(repository(calls), {
    async resolve() {
      calls.push('resolve');
      return { source: 'BLOCKED', allowed: false, reason: 'TRIAL_EXHAUSTED', remainingPoints: 0, periodEndsAt: null, perRequestAiPointCap: null };
    },
  }, ledger(calls), provider(calls));

  expect(await service.captureImage({ userId: 7, sourceId: 12, image, captureContext: null })).toMatchObject({
    status: 'BLOCKED', decision: { reason: 'TRIAL_EXHAUSTED' },
  });
  expect(calls).toEqual(['resolve']);
});

it('reserves provider-cost hold, analyzes image, persists Record and settles actual image usage', async () => {
  const calls: string[] = [];
  const service = new AiMediaCaptureService(repository(calls), {
    async resolve() {
      calls.push('resolve');
      return { source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE', remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100 };
    },
  }, ledger(calls), provider(calls));

  const result = await service.captureImage({
    userId: 7, sourceId: 12, image,
    captureContext: { client: 'CHROME_EXTENSION', page: { title: 'Example', url: 'https://example.test/' } },
  });

  expect(result).toMatchObject({ status: 'CREATED', entitlementSource: 'FREE_TRIAL', record: { id: 99, inputType: 'IMAGE' } });
  expect(calls).toEqual([
    'resolve', 'runtime', 'estimate', 'reserve:hold', 'provider', 'create-record', 'commit:IMAGE_RECORD_CREATE:99:12',
  ]);
});

it('fails closed on the AI Pro provider-cost cap before provider execution', async () => {
  const calls: string[] = [];
  const service = new AiMediaCaptureService(repository(calls), {
    async resolve() {
      return { source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE', remainingPoints: 100, periodEndsAt: '2026-10-07T00:00:00.000Z', perRequestAiPointCap: 100 };
    },
  }, ledger(calls, true), provider(calls));

  expect(await service.captureImage({ userId: 7, sourceId: 12, image, captureContext: null })).toMatchObject({
    status: 'BLOCKED', decision: { reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' },
  });
  expect(calls).toEqual(['runtime', 'estimate', 'reserve:hold']);
});
