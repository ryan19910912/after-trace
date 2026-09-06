import { describe, expect, it } from 'vitest';
import type { WorklogAiPointLedgerService } from './ai-point-ledger';
import { WorklogLineNaturalInterpreterService } from './line-natural-interpreter';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};

class FakePoints {
  reserveCalls = 0; commitCalls = 0; releaseCalls = 0;
  async reserveAi() {
    this.reserveCalls += 1;
    return { status: 'RESERVED' as const, remainingAiPoints: 0, reservation: { id: 1, token: 'reservation-1', chargedUserId: 8, actorUserId: 7, sourceId: 20, pointsReserved: 1000, pointsCommitted: 0, platformSubsidizedPoints: 0, status: 'RESERVED' as const, expiresAt: new Date('2026-09-06T03:00:00Z') } };
  }
  async commitAiUsage() { this.commitCalls += 1; return { status: 'COMMITTED' as const, reservation: { id: 1, token: 'reservation-1', chargedUserId: 8, actorUserId: 7, sourceId: 20, pointsReserved: 1000, pointsCommitted: 50, platformSubsidizedPoints: 0, status: 'COMMITTED' as const, expiresAt: new Date('2026-09-06T03:00:00Z') }, actualPoints: 50 }; }
  async releaseAi() { this.releaseCalls += 1; return { status: 'RELEASED' as const, reservation: { id: 1, token: 'reservation-1', chargedUserId: 8, actorUserId: 7, sourceId: 20, pointsReserved: 1000, pointsCommitted: 0, platformSubsidizedPoints: 0, status: 'RELEASED' as const, expiresAt: new Date('2026-09-06T03:00:00Z') } }; }
}

describe('WorklogLineNaturalInterpreterService', () => {
  it('reserves, calls provider once, and settles one usage event', async () => {
    const points = new FakePoints();
    let providerCalls = 0;
    const service = new WorklogLineNaturalInterpreterService(
      { getRuntimeConfig: async () => config },
      points as unknown as Pick<WorklogAiPointLedgerService, 'reserveAi' | 'commitAiUsage' | 'releaseAi'>,
      {
        reservationPoints: () => 500,
        interpret: async () => {
          providerCalls += 1;
          return {
            interpretation: { intent: 'QUERY' as const, queryText: '今天 晴空案' },
            inputTokens: 100, outputTokens: 20, providerResponseId: 'response-1', latencyMs: 10,
          };
        },
      },
    );
    const result = await service.interpret({
      sourceId: 20, actorUserId: 7, chargedUserId: 8,
      text: '我要查詢一下今天晴空案', referenceOccurredAt: new Date('2026-09-06T02:00:00Z'),
    });
    expect(result).toMatchObject({ status: 'INTERPRETED', interpretation: { intent: 'QUERY' } });
    expect(providerCalls).toBe(1);
    expect(points.reserveCalls).toBe(1);
    expect(points.commitCalls).toBe(1);
    expect(points.releaseCalls).toBe(0);
  });

  it('releases the reservation if provider interpretation fails', async () => {
    const points = new FakePoints();
    const service = new WorklogLineNaturalInterpreterService(
      { getRuntimeConfig: async () => config },
      points as unknown as Pick<WorklogAiPointLedgerService, 'reserveAi' | 'commitAiUsage' | 'releaseAi'>,
      { reservationPoints: () => 500, interpret: async () => { throw Object.assign(new Error('boom'), { code: 'GEMINI_NETWORK_ERROR' }); } },
    );
    await expect(service.interpret({ sourceId: 20, actorUserId: 7, chargedUserId: 8, text: '幫我查晴空案', referenceOccurredAt: new Date('2026-09-06T02:00:00Z') })).resolves.toEqual({ status: 'FAILED', reason: 'GEMINI_NETWORK_ERROR' });
    expect(points.commitCalls).toBe(0);
    expect(points.releaseCalls).toBe(1);
  });
});
