import { describe, expect, it } from 'vitest';
import { AiTaskProposalService } from './ai-task-proposal';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';

function unusedPoints(): AiPointLedgerPort {
  return {
    async reserveAi() { throw new Error('reserve should not run'); },
    async commitAiUsage() { throw new Error('commit should not run'); },
    async releaseAi() { throw new Error('release should not run'); },
  };
}

describe('AiTaskProposalService product boundary', () => {
  it('does not allow FREE AI-search trial points to unlock AI task suggestions', async () => {
    let repositoryCalls = 0;
    let providerCalls = 0;
    const service = new AiTaskProposalService(
      {
        async taskProposalEnabled() { repositoryCalls += 1; return true; },
        async runtimeConfig() { repositoryCalls += 1; return null; },
        async recordContext() { repositoryCalls += 1; return null; },
      },
      {
        async resolve() {
          return {
            source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE',
            remainingPoints: 100, periodEndsAt: null, perRequestAiPointCap: 100,
          };
        },
      },
      unusedPoints(),
      {
        reservationPoints() { providerCalls += 1; return 10; },
        async propose() { providerCalls += 1; throw new Error('provider should not run'); },
      },
    );

    expect(await service.propose({ userId: 7, sourceId: 12, text: '明天下午提醒我回覆客戶', timeZone: 'Asia/Taipei' }))
      .toEqual({
        status: 'BLOCKED',
        decision: {
          source: 'BLOCKED',
          allowed: false,
          reason: 'AI_NOT_ENTITLED',
          remainingPoints: 100,
          periodEndsAt: null,
          perRequestAiPointCap: 100,
        },
      });
    expect(repositoryCalls).toBe(0);
    expect(providerCalls).toBe(0);
  });
});
