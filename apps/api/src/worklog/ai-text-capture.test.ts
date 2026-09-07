import { describe, expect, it } from 'vitest';
import { AiTextCaptureService, type AiTextCaptureRepository } from './ai-text-capture';
import type { AiTextCaptureEntitlementPort } from './ai-text-capture';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import type { WorklogTextNormalizationProvider } from './text-normalization';

const config = {
  provider: 'GOOGLE',
  model: 'gemini-test',
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  audioUsdPerMillion: null,
  imageUsdPerMillion: null,
  usdTwdRate: 32,
};

function repository(calls?: string[]): AiTextCaptureRepository {
  return {
    async runtimeConfig() { calls?.push('runtime'); return config; },
    async createAiRecord(input) {
      calls?.push('create-record');
      return {
        workspaceId: 3,
        record: {
          id: 91,
          sourceId: input.sourceId,
          authorUserId: input.userId,
          rawText: input.rawText,
          title: input.output.title,
          searchTerms: input.output.searchTerms,
          occurredAt: input.output.occurredAt,
          createdAt: '2026-09-07T09:30:00.000Z',
        },
      };
    },
  };
}

function provider(calls: string[]): WorklogTextNormalizationProvider {
  return {
    reservationPoints() { calls.push('estimate'); return 20; },
    async normalize() {
      calls.push('provider');
      return {
        output: {
          title: '晴空案收款',
          titleRequiresConfirmation: false,
          occurredAt: '2026-09-07T00:00:00.000Z',
          searchTerms: ['晴空案', '收款'],
        },
        inputTokens: 10,
        outputTokens: 5,
        providerResponseId: 'resp-1',
        latencyMs: 20,
      };
    },
  };
}

function aiPoints(calls: string[], reserveResult?: Awaited<ReturnType<AiPointLedgerPort['reserveAi']>>): AiPointLedgerPort {
  return {
    async reserveAi() {
      calls.push('reserve');
      return reserveResult ?? {
        status: 'RESERVED',
        reservation: {
          id: 1,
          token: 'reservation-token',
          chargedUserId: 7,
          actorUserId: 7,
          sourceId: 12,
          entitlementGrantId: 11,
          pointsReserved: 20,
          pointsCommitted: 0,
          platformSubsidizedPoints: 0,
          providerCostHoldTwd: null,
          status: 'RESERVED',
          expiresAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        remainingAiPoints: 0,
      };
    },
    async commitAiUsage(_token, usage) {
      calls.push(`commit:${usage.recordId ?? 'none'}:${usage.operation ?? ''}`);
      return {
        status: 'COMMITTED',
        reservation: {
          id: 1,
          token: 'reservation-token',
          chargedUserId: 7,
          actorUserId: 7,
          sourceId: 12,
          entitlementGrantId: 11,
          pointsReserved: 20,
          pointsCommitted: 15,
          platformSubsidizedPoints: 0,
          providerCostHoldTwd: null,
          status: 'COMMITTED',
          expiresAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        actualPoints: 15,
      };
    },
    async releaseAi() { calls.push('release'); return { status: 'RESERVATION_NOT_FOUND' }; },
  };
}

describe('AiTextCaptureService', () => {
  it('blocks unauthorized/exhausted entitlement before exposing runtime config or provider work', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'BLOCKED', allowed: false, reason: 'TRIAL_EXHAUSTED',
          remainingPoints: 0, periodEndsAt: null, perRequestAiPointCap: null,
        };
      },
    };
    const service = new AiTextCaptureService(repository(calls), entitlement, aiPoints(calls), provider(calls));

    const result = await service.capture({ userId: 7, sourceId: 12, text: '今天晴空案收到款項' });

    expect(result).toMatchObject({ status: 'BLOCKED', decision: { reason: 'TRIAL_EXHAUSTED' } });
    expect(calls).toEqual(['resolve']);
  });

  it('uses resolve -> runtime -> estimate -> entitled reservation -> provider -> Record -> settlement', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE',
          remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100,
        };
      },
    };
    const service = new AiTextCaptureService(repository(calls), entitlement, aiPoints(calls), provider(calls));

    const result = await service.capture({ userId: 7, sourceId: 12, text: '今天晴空案收到款項' });

    expect(result).toMatchObject({
      status: 'CREATED',
      entitlementSource: 'FREE_TRIAL',
      record: { id: 91, title: '晴空案收款', searchTerms: ['晴空案', '收款'] },
    });
    expect(calls).toEqual([
      'resolve', 'runtime', 'estimate', 'reserve', 'provider',
      'create-record', 'commit:91:AI_TEXT_CAPTURE',
    ]);
  });

  it('surfaces exact entitled-ledger hard-cap reasons before provider execution', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async resolve() {
        return {
          source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE',
          remainingPoints: 30, periodEndsAt: '2026-10-07T00:00:00.000Z', perRequestAiPointCap: 100,
        };
      },
    };
    const blocked = { status: 'AI_ENTITLEMENT_BLOCKED', reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' } as const;
    const service = new AiTextCaptureService(repository(calls), entitlement, aiPoints(calls, blocked), provider(calls));

    const result = await service.capture({ userId: 7, sourceId: 12, text: 'test' });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      decision: { source: 'BLOCKED', reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' },
    });
    expect(calls).toEqual(['runtime', 'estimate', 'reserve']);
  });

  it('releases the reservation when provider fails before a response is completed', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async resolve() {
        return {
          source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE',
          remainingPoints: 210, periodEndsAt: '2026-10-07T00:00:00.000Z', perRequestAiPointCap: 100,
        };
      },
    };
    const failingProvider: WorklogTextNormalizationProvider = {
      reservationPoints() { return 10; },
      async normalize() { calls.push('provider'); throw new Error('GEMINI_UPSTREAM_FAILURE'); },
    };
    const service = new AiTextCaptureService(repository(), entitlement, aiPoints(calls), failingProvider);

    const result = await service.capture({ userId: 7, sourceId: 12, text: 'test' });

    expect(result).toEqual({ status: 'FAILED', reason: 'GEMINI_UPSTREAM_FAILURE' });
    expect(calls).toEqual(['reserve', 'provider', 'release']);
  });
});
