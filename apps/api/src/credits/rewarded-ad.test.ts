import { describe, expect, it, vi } from 'vitest';
import { defaultProductConfig } from '../config/product';
import type { CreditLedgerMutation } from './ledger';
import {
  RewardedAdService,
  rewardedAdPolicyDay,
  type RewardedAdLedgerPort,
  type RewardedAdRepository,
} from './rewarded-ad';

describe('rewardedAdPolicyDay', () => {
  it('uses Taiwan calendar day for the V1 daily policy', () => {
    expect(rewardedAdPolicyDay(new Date('2026-08-28T16:30:00Z'))).toBe('2026-08-29');
  });
});

describe('RewardedAdService', () => {
  it('enforces repository policy before granting AD credit', async () => {
    const claimReward = vi.fn(async () => ({
      id: 3,
      groupId: 7,
      actorLineUserId: 'U123',
      rewardEventId: 'reward-1',
      policyDay: '2026-08-29',
      amountUnits: 1_000_000n,
      status: 'PENDING' as const,
      grantOperationId: null,
    }));
    const repository: RewardedAdRepository = {
      claimReward,
      completeGrant: vi.fn(async () => 'COMPLETED' as const),
    };
    const grant = vi.fn(
      async (): Promise<CreditLedgerMutation> => ({ status: 'APPLIED', operationId: 81 }),
    );
    const ledger: RewardedAdLedgerPort = { grant };
    const service = new RewardedAdService(repository, ledger, defaultProductConfig);
    const at = new Date('2026-08-29T02:00:00+08:00');

    await expect(service.grantVerifiedReward(7, 'U123', 'reward-1', at)).resolves.toMatchObject({
      status: 'GRANTED',
      grantId: 3,
      operationId: 81,
      amountUnits: 1_000_000n,
    });
    expect(claimReward).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 7,
        rewardEventId: 'reward-1',
        policyDay: '2026-08-29',
        dailyLimit: 5,
      }),
    );
  });

  it('never reaches the ledger when the daily/cooldown policy rejects the proof', async () => {
    const repository: RewardedAdRepository = {
      claimReward: vi.fn(async () => ({
        id: 4,
        groupId: 7,
        actorLineUserId: 'U123',
        rewardEventId: 'reward-2',
        policyDay: '2026-08-29',
        amountUnits: 1_000_000n,
        status: 'REJECTED_POLICY' as const,
        grantOperationId: null,
      })),
      completeGrant: vi.fn(async () => 'COMPLETED' as const),
    };
    const grant = vi.fn();
    const service = new RewardedAdService(
      repository,
      { grant } as unknown as RewardedAdLedgerPort,
      defaultProductConfig,
    );

    await expect(service.grantVerifiedReward(7, 'U123', 'reward-2')).resolves.toEqual({
      status: 'POLICY_REJECTED',
      grantId: 4,
    });
    expect(grant).not.toHaveBeenCalled();
  });
});
