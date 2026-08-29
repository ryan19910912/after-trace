import { describe, expect, it } from 'vitest';
import {
  lifetimeFreeGrant,
  paidPackGrant,
  rewardedAdGrant,
  subscriptionCycleGrant,
} from './products';

describe('Energy product grants', () => {
  it('uses one stable lifetime FREE source per user', () => {
    expect(lifetimeFreeGrant(12, 100n)).toEqual({
      userId: 12,
      bucket: 'FREE',
      units: 100n,
      sourceType: 'FREE_LIFETIME',
      sourceId: 'V1',
      expiresAt: null,
    });
  });

  it('expires subscription Energy at provider period_end', () => {
    const periodStart = new Date('2026-08-01T00:00:00Z');
    const periodEnd = new Date('2026-09-01T00:00:00Z');
    const grant = subscriptionCycleGrant({
      userId: 12,
      units: 500n,
      provider: 'test-pay',
      subscriptionId: 'sub-1',
      cycleId: 'cycle-2026-08',
      periodStart,
      periodEnd,
    });
    expect(grant.bucket).toBe('SUBSCRIPTION');
    expect(grant.expiresAt).toEqual(periodEnd);
    expect(grant.sourceId).toBe('test-pay:cycle-2026-08');
  });

  it('expires rewarded AD Energy exactly seven days after grant', () => {
    const grantedAt = new Date('2026-08-29T00:00:00Z');
    expect(rewardedAdGrant({ userId: 12, units: 20n, claimId: 'nonce-1', grantedAt }).expiresAt)
      .toEqual(new Date('2026-09-05T00:00:00Z'));
  });

  it.each(['SMALL', 'MEDIUM', 'LARGE'] as const)('supports non-expiring %s PAID pack', (packCode) => {
    const grant = paidPackGrant({
      userId: 12,
      units: 100n,
      provider: 'test-pay',
      providerPurchaseId: `purchase-${packCode}`,
      packCode,
    });
    expect(grant.bucket).toBe('PAID');
    expect(grant.expiresAt).toBeNull();
    expect(grant.metadata?.packCode).toBe(packCode);
  });

  it('rejects invalid cycle boundaries and non-positive grants', () => {
    expect(() => lifetimeFreeGrant(12, 0n)).toThrow('positive');
    expect(() => subscriptionCycleGrant({
      userId: 12,
      units: 1n,
      provider: 'test-pay',
      subscriptionId: 'sub-1',
      cycleId: 'cycle-1',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-09-01T00:00:00Z'),
    })).toThrow('period_end');
  });
});
