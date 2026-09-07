import { describe, expect, it } from 'vitest';
import {
  AiEntitlementService,
  type AiEntitlementRepository,
  type AiEntitlementSnapshot,
} from './ai-entitlement';

const now = new Date('2026-09-07T08:00:00.000Z');
const periodEnd = new Date('2026-10-07T08:00:00.000Z');

class FakeRepository implements AiEntitlementRepository {
  scopes: Array<{ grantId: number; sourceId: number }> = [];
  value: AiEntitlementSnapshot = {
    sourceAuthorized: true,
    freeTrial: { grantId: 11, remainingPoints: 120 },
    aiPro: null,
  };

  async snapshot(): Promise<AiEntitlementSnapshot> { return this.value; }
  async ensureGrantScope(grantId: number, sourceId: number): Promise<void> {
    this.scopes.push({ grantId, sourceId });
  }
}

describe('AiEntitlementService', () => {
  it('uses the requesting users FREE trial for an authorized Source', async () => {
    const repository = new FakeRepository();
    const result = await new AiEntitlementService(repository).resolve(7, 99, now);
    expect(result).toEqual({
      source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE',
      remainingPoints: 120, periodEndsAt: null,
    });
    expect(repository.scopes).toEqual([{ grantId: 11, sourceId: 99 }]);
  });

  it('never grants AI merely because a GROUP Source exists without membership', async () => {
    const repository = new FakeRepository();
    repository.value = { ...repository.value, sourceAuthorized: false };
    const result = await new AiEntitlementService(repository).resolve(7, 99, now);
    expect(result.source).toBe('BLOCKED');
    expect(result.reason).toBe('SOURCE_NOT_AUTHORIZED');
    expect(repository.scopes).toEqual([]);
  });

  it('prefers active AI Pro and enforces monthly point cap', async () => {
    const repository = new FakeRepository();
    repository.value = {
      sourceAuthorized: true,
      freeTrial: { grantId: 11, remainingPoints: 120 },
      aiPro: {
        planEnabled: true, aiEnabled: true, grantId: 22,
        periodStart: now, periodEnd,
        monthlyPointCap: 1000, monthlyProviderCostCapTwd: 30,
        pointsUsed: 1000, providerCostTwd: 8,
      },
    };
    const result = await new AiEntitlementService(repository).resolve(7, 99, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'MONTHLY_POINT_CAP_REACHED' });
    expect(repository.scopes).toEqual([]);
  });

  it('enforces AI Pro provider-cost hard cap before provider work', async () => {
    const repository = new FakeRepository();
    repository.value = {
      sourceAuthorized: true,
      freeTrial: null,
      aiPro: {
        planEnabled: true, aiEnabled: true, grantId: 22,
        periodStart: now, periodEnd,
        monthlyPointCap: 1000, monthlyProviderCostCapTwd: 30,
        pointsUsed: 200, providerCostTwd: 30,
      },
    };
    const result = await new AiEntitlementService(repository).resolve(7, 99, now);
    expect(result).toMatchObject({
      source: 'BLOCKED', reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED', remainingPoints: 800,
    });
  });

  it('returns AI_PRO and creates a Source scope from the users current period grant', async () => {
    const repository = new FakeRepository();
    repository.value = {
      sourceAuthorized: true,
      freeTrial: null,
      aiPro: {
        planEnabled: true, aiEnabled: true, grantId: 22,
        periodStart: now, periodEnd,
        monthlyPointCap: 1000, monthlyProviderCostCapTwd: 30,
        pointsUsed: 200, providerCostTwd: 5,
      },
    };
    const result = await new AiEntitlementService(repository).resolve(7, 99, now);
    expect(result).toEqual({
      source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE',
      remainingPoints: 800, periodEndsAt: periodEnd.toISOString(),
    });
    expect(repository.scopes).toEqual([{ grantId: 22, sourceId: 99 }]);
  });
});
