import { describe, expect, it } from 'vitest';
import { AiTaskProposalService } from './ai-task-proposal';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';

function points(calls: string[]): AiPointLedgerPort {
  return {
    async reserveAi() {
      calls.push('reserve');
      return {
        status: 'RESERVED',
        reservation: {
          id: 1, token: 'trial-task', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 3, pointsReserved: 10, pointsCommitted: 0,
          platformSubsidizedPoints: 0, providerCostHoldTwd: null, status: 'RESERVED',
          expiresAt: new Date('2026-09-15T15:00:00Z'),
        },
        remainingAiPoints: 90,
      };
    },
    async commitAiUsage() {
      calls.push('commit');
      return {
        status: 'COMMITTED',
        reservation: {
          id: 1, token: 'trial-task', chargedUserId: 7, actorUserId: 7, sourceId: 12,
          entitlementGrantId: 3, pointsReserved: 10, pointsCommitted: 8,
          platformSubsidizedPoints: 0, providerCostHoldTwd: null, status: 'COMMITTED',
          expiresAt: new Date('2026-09-15T15:00:00Z'),
        },
        actualPoints: 8,
      };
    },
    async releaseAi() { return { status: 'RESERVATION_NOT_FOUND' }; },
  };
}

describe('AiTaskProposalService product boundary', () => {
  it('allows one-time FREE AI experience points to create an AI task proposal', async () => {
    const calls: string[] = [];
    const service = new AiTaskProposalService(
      {
        async taskProposalEnabled() { calls.push('enabled'); return true; },
        async runtimeConfig() {
          calls.push('runtime');
          return { provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 1, outputUsdPerMillion: 2, audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32 };
        },
        async recordContext() { throw new Error('record context should not run without recordId'); },
      },
      {
        async resolve() {
          return { source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE', remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100 };
        },
      },
      points(calls),
      {
        reservationPoints() { calls.push('estimate'); return 10; },
        async propose() {
          calls.push('provider');
          return {
            title: '回覆客戶', body: null, dueAt: '2026-09-16T07:00:00.000Z', remindAt: null,
            inputTokens: 10, outputTokens: 5, providerResponseId: 'task-1', latencyMs: 20,
          };
        },
      },
    );

    const result = await service.propose({ userId: 7, sourceId: 12, text: '明天下午提醒我回覆客戶', timeZone: 'Asia/Taipei' });
    expect(result).toMatchObject({ status: 'PROPOSAL', entitlementSource: 'FREE_TRIAL', title: '回覆客戶' });
    expect(calls).toEqual(['enabled', 'runtime', 'estimate', 'reserve', 'provider', 'commit']);
  });
});
