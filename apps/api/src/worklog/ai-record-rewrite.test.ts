import { describe, expect, it } from 'vitest';
import { AiRecordRewriteService, type AiRecordRewriteRepository } from './ai-record-rewrite';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';

const config = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};

function repository(calls: string[]): AiRecordRewriteRepository {
  return {
    async rewriteEnabled() { calls.push('capability'); return true; },
    async runtimeConfig() { calls.push('runtime'); return config; },
    async recordForRewrite(sourceId, recordId) {
      calls.push(`record:${sourceId}:${recordId}`);
      return { id: recordId, sourceId, version: 4, title: '原標題', rawText: '今天完成晴空案第一階段。', occurredAt: null };
    },
  };
}

function ledger(calls: string[]): AiPointLedgerPort {
  return {
    async reserveAi(input) {
      calls.push(`reserve:${input.providerCostHoldTwd === null ? 'no-hold' : 'hold'}`);
      return {
        status: 'RESERVED',
        reservation: {
          id: 1, token: 'rewrite-token', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 5, pointsReserved: 40, pointsCommitted: 0, platformSubsidizedPoints: 0,
          providerCostHoldTwd: input.providerCostHoldTwd, status: 'RESERVED', expiresAt: new Date('2026-09-07T15:00:00.000Z'),
        },
        remainingAiPoints: 60,
      };
    },
    async commitAiUsage(_token, usage) {
      calls.push(`commit:${usage.operation}:${usage.recordId}`);
      return {
        status: 'COMMITTED', actualPoints: 18,
        reservation: {
          id: 1, token: 'rewrite-token', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 5, pointsReserved: 40, pointsCommitted: 18, platformSubsidizedPoints: 0,
          providerCostHoldTwd: 0.01, status: 'COMMITTED', expiresAt: new Date('2026-09-07T15:00:00.000Z'),
        },
      };
    },
    async releaseAi() { calls.push('release'); return { status: 'RESERVATION_NOT_FOUND' }; },
  };
}

function rewriteProvider(calls: string[]) {
  return {
    reservationPoints() { calls.push('estimate'); return 40; },
    async rewrite() {
      calls.push('provider');
      return { proposedText: '晴空案第一階段今日完成。', inputTokens: 40, outputTokens: 12, providerResponseId: 'rewrite-resp', latencyMs: 5 };
    },
  };
}

describe('AiRecordRewriteService', () => {
  it('checks entitlement before target Record existence to avoid cross-Source enumeration', async () => {
    const calls: string[] = [];
    const service = new AiRecordRewriteService(repository(calls), {
      async resolve() { calls.push('resolve'); return { source: 'BLOCKED', allowed: false, reason: 'SOURCE_NOT_AUTHORIZED', remainingPoints: null, periodEndsAt: null, perRequestAiPointCap: null }; },
    }, ledger(calls), rewriteProvider(calls));
    expect(await service.propose({ userId: 7, sourceId: 12, recordId: 99, instruction: '改得更精簡' })).toMatchObject({ status: 'BLOCKED', decision: { reason: 'SOURCE_NOT_AUTHORIZED' } });
    expect(calls).toEqual(['resolve']);
  });

  it('allows FREE trial points to unlock AI rewrite', async () => {
    const calls: string[] = [];
    const service = new AiRecordRewriteService(repository(calls), {
      async resolve() { calls.push('resolve'); return { source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE', remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100 }; },
    }, ledger(calls), rewriteProvider(calls));
    const result = await service.propose({ userId: 7, sourceId: 12, recordId: 99, instruction: '改得更精簡' });
    expect(result).toMatchObject({ status: 'PROPOSAL', entitlementSource: 'FREE_TRIAL', recordId: 99 });
    expect(calls).toEqual(['resolve', 'capability', 'record:12:99', 'runtime', 'estimate', 'reserve:hold', 'provider', 'commit:AI_RECORD_REWRITE_PROPOSAL:99']);
  });

  it('returns an AI Pro proposal and expectedVersion without mutating a Record', async () => {
    const calls: string[] = [];
    const service = new AiRecordRewriteService(repository(calls), {
      async resolve() { calls.push('resolve'); return { source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE', remainingPoints: 100, periodEndsAt: '2026-10-01T00:00:00.000Z', perRequestAiPointCap: 100 }; },
    }, ledger(calls), rewriteProvider(calls));
    const result = await service.propose({ userId: 7, sourceId: 12, recordId: 99, instruction: '改得更精簡' });
    expect(result).toMatchObject({ status: 'PROPOSAL', entitlementSource: 'AI_PRO', recordId: 99, expectedVersion: 4, originalText: '今天完成晴空案第一階段。', proposedText: '晴空案第一階段今日完成。' });
    expect(calls).toEqual(['resolve', 'capability', 'record:12:99', 'runtime', 'estimate', 'reserve:hold', 'provider', 'commit:AI_RECORD_REWRITE_PROPOSAL:99']);
  });
});
