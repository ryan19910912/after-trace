import { describe, expect, it, vi } from 'vitest';
import { BackgroundAiSettlementService } from './ai-settlement';

describe('BackgroundAiSettlementService', () => {
  it('preserves eligible-only proportional shares for repository settlement', async () => {
    const settle = vi.fn(async () => ({
      status: 'SETTLED' as const,
      userChargedUnits: 10n,
      platformSubsidyUnits: 0n,
    }));
    const service = new BackgroundAiSettlementService({ settle });
    await service.settle({
      requestId: 9,
      groupId: 3,
      eligibleSubjects: [
        { userId: 1, lineUserId: 'U1', normalizedCharCount: 600, preflightAvailableUnits: 100n },
        { userId: 2, lineUserId: 'U2', normalizedCharCount: 400, preflightAvailableUnits: 100n },
      ],
      actualCostEnergyUnits: 10n,
      actualCostTwd: '0.05000000',
      globalFreeAiBudgetCostTwd: 50,
      at: new Date('2026-08-29T00:00:00Z'),
    });

    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 9,
      totalEnergyUnits: 10n,
      shares: [
        { userId: 1, lineUserId: 'U1', allocatedUnits: 6n },
        { userId: 2, lineUserId: 'U2', allocatedUnits: 4n },
      ],
    }));
  });
});
