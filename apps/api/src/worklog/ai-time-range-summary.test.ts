import { describe, expect, it } from 'vitest';
import {
  AiTimeRangeSummaryService,
  type AiTimeRangeSummaryRecord,
  type AiTimeRangeSummaryRepository,
} from './ai-time-range-summary';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';

const config = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};

function repository(calls: string[], records: AiTimeRangeSummaryRecord[] = [{
  id: 1, inputType: 'TEXT', title: '晴空案', rawText: '完成第一階段驗收',
  occurredAt: '2026-09-01T02:00:00.000Z', createdAt: '2026-09-01T02:01:00.000Z',
}]): AiTimeRangeSummaryRepository {
  return {
    async summaryEnabled() { calls.push('capability'); return true; },
    async runtimeConfig() { calls.push('runtime'); return config; },
    async recordsForRange() { calls.push('records'); return records; },
  };
}

function ledger(calls: string[]): AiPointLedgerPort {
  return {
    async reserveAi(input) {
      calls.push(`reserve:${input.providerCostHoldTwd === null ? 'no-hold' : 'hold'}`);
      return {
        status: 'RESERVED',
        reservation: {
          id: 1, token: 'summary-token', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 5, pointsReserved: 50, pointsCommitted: 0, platformSubsidizedPoints: 0,
          providerCostHoldTwd: input.providerCostHoldTwd, status: 'RESERVED', expiresAt: new Date('2026-09-07T14:00:00.000Z'),
        },
        remainingAiPoints: 50,
      };
    },
    async commitAiUsage(_token, usage) {
      calls.push(`commit:${usage.operation}:${usage.inputTokens}:${usage.outputTokens}`);
      return {
        status: 'COMMITTED', actualPoints: 20,
        reservation: {
          id: 1, token: 'summary-token', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 5, pointsReserved: 50, pointsCommitted: 20, platformSubsidizedPoints: 0,
          providerCostHoldTwd: 0.01, status: 'COMMITTED', expiresAt: new Date('2026-09-07T14:00:00.000Z'),
        },
      };
    },
    async releaseAi() { calls.push('release'); return { status: 'RESERVATION_NOT_FOUND' }; },
  };
}

const range = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-09-08T00:00:00.000Z'),
};

describe('AiTimeRangeSummaryService', () => {
  it('checks entitlement before capability, Record retrieval or provider state', async () => {
    const calls: string[] = [];
    const service = new AiTimeRangeSummaryService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return { source: 'BLOCKED', allowed: false, reason: 'SOURCE_NOT_AUTHORIZED', remainingPoints: null, periodEndsAt: null, perRequestAiPointCap: null };
      },
    }, ledger(calls), {
      reservationPoints() { calls.push('estimate'); return 50; },
      async summarize() { calls.push('provider'); throw new Error('should not run'); },
    });

    const result = await service.summarize({ userId: 7, sourceId: 12, ...range });
    expect(result).toMatchObject({ status: 'BLOCKED', decision: { reason: 'SOURCE_NOT_AUTHORIZED' } });
    expect(calls).toEqual(['resolve']);
  });

  it('returns NO_RECORDS without runtime lookup, reservation or provider cost', async () => {
    const calls: string[] = [];
    const service = new AiTimeRangeSummaryService(repository(calls, []), {
      async resolve() {
        calls.push('resolve');
        return { source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE', remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100 };
      },
    }, ledger(calls), {
      reservationPoints() { calls.push('estimate'); return 50; },
      async summarize() { calls.push('provider'); throw new Error('should not run'); },
    });

    const result = await service.summarize({ userId: 7, sourceId: 12, ...range });
    expect(result).toMatchObject({ status: 'NO_RECORDS' });
    expect(calls).toEqual(['resolve', 'capability', 'records']);
  });

  it('retrieves bounded Records before reservation and settles provider usage after summary success', async () => {
    const calls: string[] = [];
    const service = new AiTimeRangeSummaryService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return { source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE', remainingPoints: 500, periodEndsAt: '2026-10-01T00:00:00.000Z', perRequestAiPointCap: 200 };
      },
    }, ledger(calls), {
      reservationPoints(input) { calls.push(`estimate:${input.records.length}`); return 50; },
      async summarize(input) {
        calls.push(`provider:${input.records.length}`);
        return { summary: '本週完成晴空案第一階段驗收。', inputTokens: 100, outputTokens: 20, providerResponseId: 'resp-summary', latencyMs: 10 };
      },
    });

    const result = await service.summarize({ userId: 7, sourceId: 12, ...range });
    expect(result).toMatchObject({ status: 'SUMMARY', entitlementSource: 'AI_PRO', recordCount: 1, truncated: false });
    expect(calls).toEqual([
      'resolve', 'capability', 'records', 'runtime', 'estimate:1', 'reserve:hold', 'provider:1',
      'commit:AI_TIME_RANGE_SUMMARY:100:20',
    ]);
  });

  it('bounds provider text size even when fewer than 200 Records contain large manual content', async () => {
    const calls: string[] = [];
    const largeRecords: AiTimeRangeSummaryRecord[] = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      inputType: 'TEXT',
      title: null,
      rawText: 'x'.repeat(20_000),
      occurredAt: `2026-09-0${Math.min(index + 1, 9)}T02:00:00.000Z`,
      createdAt: `2026-09-0${Math.min(index + 1, 9)}T02:01:00.000Z`,
    }));
    const service = new AiTimeRangeSummaryService(repository(calls, largeRecords), {
      async resolve() {
        calls.push('resolve');
        return { source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE', remainingPoints: 500, periodEndsAt: '2026-10-01T00:00:00.000Z', perRequestAiPointCap: 200 };
      },
    }, ledger(calls), {
      reservationPoints(input) { calls.push(`estimate:${input.records.length}`); return 50; },
      async summarize(input) {
        calls.push(`provider:${input.records.length}`);
        expect(input.records.reduce((sum, record) => sum + record.rawText.length, 0)).toBeLessThanOrEqual(120_000);
        return { summary: '大型資料集仍以 bounded provider input 摘要。', inputTokens: 100, outputTokens: 20, providerResponseId: 'resp-summary-large', latencyMs: 10 };
      },
    });

    const result = await service.summarize({ userId: 7, sourceId: 12, ...range });
    expect(result).toMatchObject({ status: 'SUMMARY', recordCount: 5, truncated: true });
    expect(calls).toContain('estimate:5');
    expect(calls).toContain('provider:5');
  });
});