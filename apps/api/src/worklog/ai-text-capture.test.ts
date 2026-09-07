import { describe, expect, it } from 'vitest';
import type { WorklogAiPointLedgerService } from './ai-point-ledger';
import { AiTextCaptureService, type AiTextCaptureRepository } from './ai-text-capture';
import type { AiTextCaptureEntitlementPort } from './ai-text-capture';
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

function repository(): AiTextCaptureRepository {
  return {
    async runtimeConfig() { return config; },
    async createAiRecord(input) {
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

function ledger(calls: string[]): WorklogAiPointLedgerService {
  return {
    async reserveAi() {
      calls.push('reserve');
      return {
        status: 'RESERVED',
        reservation: {
          id: 1,
          token: 'reservation-token',
          chargedUserId: 7,
          actorUserId: 7,
          sourceId: 12,
          pointsReserved: 20,
          pointsCommitted: 0,
          platformSubsidizedPoints: 0,
          status: 'RESERVED',
          expiresAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        remainingAiPoints: 0,
      } as const;
    },
    async commitAiUsage(_token: string, usage: { recordId?: number | null; operation?: string }) {
      calls.push(`commit:${usage.recordId ?? 'none'}:${usage.operation ?? ''}`);
      return {
        status: 'COMMITTED',
        reservation: {
          id: 1,
          token: 'reservation-token',
          chargedUserId: 7,
          actorUserId: 7,
          sourceId: 12,
          pointsReserved: 20,
          pointsCommitted: 15,
          platformSubsidizedPoints: 0,
          status: 'COMMITTED',
          expiresAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        actualPoints: 15,
      } as const;
    },
    async releaseAi() { calls.push('release'); return { status: 'RESERVATION_NOT_FOUND' } as const; },
  } as unknown as WorklogAiPointLedgerService;
}

describe('AiTextCaptureService', () => {
  it('does not reserve or call provider when unified entitlement blocks the request', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async admit() {
        calls.push('admit');
        return {
          source: 'BLOCKED', allowed: false, reason: 'TRIAL_EXHAUSTED',
          remainingPoints: 0, periodEndsAt: null,
        };
      },
    };
    const service = new AiTextCaptureService(repository(), entitlement, ledger(calls), provider(calls));

    const result = await service.capture({ userId: 7, sourceId: 12, text: '今天晴空案收到款項' });

    expect(result).toMatchObject({ status: 'BLOCKED', decision: { reason: 'TRIAL_EXHAUSTED' } });
    expect(calls).toEqual(['estimate', 'admit']);
  });

  it('uses admit -> reservation -> provider -> enriched Record -> settlement for FREE trial', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async admit(_userId, _sourceId, requestedPoints) {
        calls.push(`admit:${requestedPoints}`);
        return {
          source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE',
          remainingPoints: 80, periodEndsAt: null,
        };
      },
    };
    const service = new AiTextCaptureService(repository(), entitlement, ledger(calls), provider(calls));

    const result = await service.capture({ userId: 7, sourceId: 12, text: '今天晴空案收到款項' });

    expect(result).toMatchObject({
      status: 'CREATED',
      entitlementSource: 'FREE_TRIAL',
      record: { id: 91, title: '晴空案收款', searchTerms: ['晴空案', '收款'] },
    });
    expect(calls).toEqual(['estimate', 'admit:20', 'reserve', 'provider', 'commit:91:AI_TEXT_CAPTURE']);
  });

  it('releases the reservation when provider fails before a response is completed', async () => {
    const calls: string[] = [];
    const entitlement: AiTextCaptureEntitlementPort = {
      async admit() {
        return {
          source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE',
          remainingPoints: 200, periodEndsAt: '2026-10-07T00:00:00.000Z',
        };
      },
    };
    const failingProvider: WorklogTextNormalizationProvider = {
      reservationPoints() { return 10; },
      async normalize() { calls.push('provider'); throw new Error('GEMINI_UPSTREAM_FAILURE'); },
    };
    const service = new AiTextCaptureService(repository(), entitlement, ledger(calls), failingProvider);

    const result = await service.capture({ userId: 7, sourceId: 12, text: 'test' });

    expect(result).toEqual({ status: 'FAILED', reason: 'GEMINI_UPSTREAM_FAILURE' });
    expect(calls).toEqual(['reserve', 'provider', 'release']);
  });
});
