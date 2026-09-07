import { describe, expect, it } from 'vitest';
import {
  AiNaturalSearchService,
  type AiNaturalSearchProvider,
  type AiNaturalSearchRepository,
} from './ai-natural-search';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';

const config = {
  provider: 'GOOGLE',
  model: 'gemini-test',
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  audioUsdPerMillion: null,
  imageUsdPerMillion: null,
  usdTwdRate: 32,
};

function repository(calls: string[], options: { enabled?: boolean; retrievalFails?: boolean } = {}): AiNaturalSearchRepository {
  return {
    async searchEnabled() { calls.push('enabled'); return options.enabled !== false; },
    async runtimeConfig() { calls.push('runtime'); return config; },
    async searchRecords(input) {
      calls.push(`retrieve:${input.terms.join('|')}`);
      if (options.retrievalFails) throw new Error('AI_SEARCH_RETRIEVAL_FAILED');
      return [{
        id: 91,
        sourceId: input.sourceId,
        inputType: 'TEXT',
        title: '晴空案收款',
        rawText: '昨天晴空案收到 3000 元清潔費。',
        occurredAt: '2026-09-06T02:00:00.000Z',
        createdAt: '2026-09-06T02:05:00.000Z',
      }];
    },
  };
}

function provider(calls: string[]): AiNaturalSearchProvider {
  return {
    reservationPoints() { calls.push('estimate'); return 20; },
    async interpret(input) {
      calls.push(`provider:${input.timeZone}`);
      return {
        interpretation: {
          terms: ['晴空案', '收款'],
          from: '2026-09-06T00:00:00.000Z',
          to: '2026-09-07T00:00:00.000Z',
        },
        inputTokens: 20,
        outputTokens: 8,
        providerResponseId: 'search-response',
        latencyMs: 15,
      };
    },
  };
}

function ledger(
  calls: string[],
  reserveResult?: Awaited<ReturnType<AiPointLedgerPort['reserveAi']>>,
): AiPointLedgerPort {
  return {
    async reserveAi(input) {
      calls.push(`reserve:${input.providerCostHoldTwd === null ? 'no-hold' : 'hold'}`);
      return reserveResult ?? {
        status: 'RESERVED',
        reservation: {
          id: 1,
          token: 'search-token',
          chargedUserId: 7,
          actorUserId: 7,
          sourceId: 12,
          entitlementGrantId: 5,
          pointsReserved: 20,
          pointsCommitted: 0,
          platformSubsidizedPoints: 0,
          providerCostHoldTwd: input.providerCostHoldTwd,
          status: 'RESERVED',
          expiresAt: new Date('2026-09-07T14:00:00.000Z'),
        },
        remainingAiPoints: 80,
      };
    },
    async commitAiUsage(_token, usage) {
      calls.push(`commit:${usage.operation}:${usage.recordId ?? 'none'}`);
      return {
        status: 'COMMITTED',
        reservation: {
          id: 1,
          token: 'search-token',
          chargedUserId: 7,
          actorUserId: 7,
          sourceId: 12,
          entitlementGrantId: 5,
          pointsReserved: 20,
          pointsCommitted: 14,
          platformSubsidizedPoints: 0,
          providerCostHoldTwd: 0.00128,
          status: 'COMMITTED',
          expiresAt: new Date('2026-09-07T14:00:00.000Z'),
        },
        actualPoints: 14,
      };
    },
    async releaseAi() { calls.push('release'); return { status: 'RESERVATION_NOT_FOUND' }; },
  };
}

describe('AiNaturalSearchService', () => {
  it('blocks Source/entitlement before capability, runtime, ledger or provider work', async () => {
    const calls: string[] = [];
    const service = new AiNaturalSearchService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'BLOCKED',
          allowed: false,
          reason: 'SOURCE_NOT_AUTHORIZED',
          remainingPoints: null,
          periodEndsAt: null,
          perRequestAiPointCap: null,
        };
      },
    }, ledger(calls), provider(calls));

    const result = await service.search({ userId: 7, sourceId: 12, query: '昨天晴空案的收款', timeZone: 'Asia/Taipei' });

    expect(result).toMatchObject({ status: 'BLOCKED', decision: { reason: 'SOURCE_NOT_AUTHORIZED' } });
    expect(calls).toEqual(['resolve']);
  });

  it('interprets with provider but retrieves deterministically from PostgreSQL and settles actual usage', async () => {
    const calls: string[] = [];
    const service = new AiNaturalSearchService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'FREE_TRIAL',
          allowed: true,
          reason: 'FREE_TRIAL_AVAILABLE',
          remainingPoints: 100,
          periodEndsAt: null,
          perRequestAiPointCap: 100,
        };
      },
    }, ledger(calls), provider(calls));

    const result = await service.search({
      userId: 7,
      sourceId: 12,
      query: '昨天晴空案的收款',
      timeZone: 'Asia/Taipei',
      referenceAt: new Date('2026-09-07T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'RESULTS',
      entitlementSource: 'FREE_TRIAL',
      interpretation: { terms: ['晴空案', '收款'] },
      records: [{ id: 91, sourceId: 12, rawText: '昨天晴空案收到 3000 元清潔費。' }],
    });
    expect(calls).toEqual([
      'resolve', 'enabled', 'runtime', 'estimate', 'reserve:hold', 'provider:Asia/Taipei',
      'retrieve:晴空案|收款', 'commit:AI_NATURAL_SEARCH:none',
    ]);
  });

  it('fails closed on the AI Pro provider-cost hard cap before provider/retrieval', async () => {
    const calls: string[] = [];
    const blocked = { status: 'AI_ENTITLEMENT_BLOCKED', reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' } as const;
    const service = new AiNaturalSearchService(repository(calls), {
      async resolve() {
        return {
          source: 'AI_PRO',
          allowed: true,
          reason: 'AI_PRO_AVAILABLE',
          remainingPoints: 100,
          periodEndsAt: '2026-10-07T00:00:00.000Z',
          perRequestAiPointCap: 100,
        };
      },
    }, ledger(calls, blocked), provider(calls));

    const result = await service.search({ userId: 7, sourceId: 12, query: '晴空案', timeZone: 'Asia/Taipei' });

    expect(result).toMatchObject({ status: 'BLOCKED', decision: { reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED' } });
    expect(calls).toEqual(['enabled', 'runtime', 'estimate', 'reserve:hold']);
  });

  it('settles provider success even when deterministic retrieval fails afterwards', async () => {
    const calls: string[] = [];
    const service = new AiNaturalSearchService(repository(calls, { retrievalFails: true }), {
      async resolve() {
        return {
          source: 'FREE_TRIAL',
          allowed: true,
          reason: 'FREE_TRIAL_AVAILABLE',
          remainingPoints: 100,
          periodEndsAt: null,
          perRequestAiPointCap: 100,
        };
      },
    }, ledger(calls), provider(calls));

    const result = await service.search({ userId: 7, sourceId: 12, query: '晴空案', timeZone: 'Asia/Taipei' });

    expect(result).toEqual({ status: 'FAILED', reason: 'AI_SEARCH_RETRIEVAL_FAILED' });
    expect(calls).toContain('commit:AI_NATURAL_SEARCH:none');
    expect(calls.indexOf('provider:Asia/Taipei')).toBeLessThan(calls.indexOf('commit:AI_NATURAL_SEARCH:none'));
  });

  it('blocks operator-disabled natural search before runtime/reservation/provider work', async () => {
    const calls: string[] = [];
    const service = new AiNaturalSearchService(repository(calls, { enabled: false }), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'FREE_TRIAL',
          allowed: true,
          reason: 'FREE_TRIAL_AVAILABLE',
          remainingPoints: 100,
          periodEndsAt: null,
          perRequestAiPointCap: 100,
        };
      },
    }, ledger(calls), provider(calls));

    expect(await service.search({ userId: 7, sourceId: 12, query: '晴空案', timeZone: 'Asia/Taipei' }))
      .toEqual({ status: 'FAILED', reason: 'AI_NATURAL_SEARCH_DISABLED' });
    expect(calls).toEqual(['resolve', 'enabled']);
  });
});
