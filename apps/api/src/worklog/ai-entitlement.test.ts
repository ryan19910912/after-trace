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
    freeTrial: { grantId: 11, remainingPoints: 120, perRequestAiPointCap: 50 },
    aiPro: null,
  };

  async snapshot(): Promise<AiEntitlementSnapshot> { return this.value; }
  async ensureGrantScope(grantId: number, sourceId: number): Promise<void> { this.scopes.push({ grantId, sourceId }); }
}

function aiPro(overrides: Partial<NonNullable<AiEntitlementSnapshot['aiPro']>> = {}) {
  return {
    planEnabled: true,
    aiEnabled: true,
    grantId: 22,
    periodStart: now,
    periodEnd,
    monthlyPointCap: 1000,
    monthlyProviderCostCapTwd: 30,
    perRequestAiPointCap: 250,
    pointsUsed: 200,
    providerCostTwd: 5,
    missingProviderCostTwdRequests: 0,
    ...overrides,
  };
}

describe('AiEntitlementService', () => {
  it('resolves the requesting users FREE trial without mutating Source scope', async () => {
    const repository = new FakeRepository();
    const result = await new AiEntitlementService(repository).resolve(7, 99, now);
    expect(result).toEqual({
      source: 'FREE_TRIAL', allowed: true, reason: 'FREE_TRIAL_AVAILABLE',
      remainingPoints: 120, periodEndsAt: null, perRequestAiPointCap: 50,
    });
    expect(repository.scopes).toEqual([]);
  });

  it('admit creates the requesting users grant scope only after preflight succeeds', async () => {
    const repository = new FakeRepository();
    const result = await new AiEntitlementService(repository).admit(7, 99, 40, now);
    expect(result.source).toBe('FREE_TRIAL');
    expect(repository.scopes).toEqual([{ grantId: 11, sourceId: 99 }]);
  });

  it('enforces the AI Pro request cap for FREE trial provider work', async () => {
    const repository = new FakeRepository();
    const result = await new AiEntitlementService(repository).admit(7, 99, 51, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'PER_REQUEST_POINT_CAP_EXCEEDED' });
    expect(repository.scopes).toEqual([]);
  });

  it('fails closed when a FREE trial request exceeds the remaining trial points', async () => {
    const repository = new FakeRepository();
    repository.value = {
      sourceAuthorized: true,
      freeTrial: { grantId: 11, remainingPoints: 5, perRequestAiPointCap: 50 },
      aiPro: null,
    };
    const result = await new AiEntitlementService(repository).admit(7, 99, 10, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'TRIAL_EXHAUSTED', remainingPoints: 5 });
    expect(repository.scopes).toEqual([]);
  });

  it('never grants AI merely because a GROUP Source exists without membership', async () => {
    const repository = new FakeRepository();
    repository.value = { ...repository.value, sourceAuthorized: false };
    const result = await new AiEntitlementService(repository).admit(7, 99, 20, now);
    expect(result.source).toBe('BLOCKED');
    expect(result.reason).toBe('SOURCE_NOT_AUTHORIZED');
    expect(repository.scopes).toEqual([]);
  });

  it('prefers active AI Pro and enforces monthly provider-resource point cap', async () => {
    const repository = new FakeRepository();
    repository.value = {
      sourceAuthorized: true,
      freeTrial: { grantId: 11, remainingPoints: 120, perRequestAiPointCap: 50 },
      aiPro: aiPro({ pointsUsed: 1000 }),
    };
    const result = await new AiEntitlementService(repository).admit(7, 99, 20, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'MONTHLY_POINT_CAP_REACHED' });
    expect(repository.scopes).toEqual([]);
  });

  it('fails closed when current-period provider TWD accounting is incomplete', async () => {
    const repository = new FakeRepository();
    repository.value = { sourceAuthorized: true, freeTrial: null, aiPro: aiPro({ missingProviderCostTwdRequests: 1 }) };
    const result = await new AiEntitlementService(repository).admit(7, 99, 20, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'PROVIDER_COST_ACCOUNTING_INCOMPLETE' });
  });

  it('enforces AI Pro provider-cost hard cap before provider work', async () => {
    const repository = new FakeRepository();
    repository.value = { sourceAuthorized: true, freeTrial: null, aiPro: aiPro({ providerCostTwd: 30 }) };
    const result = await new AiEntitlementService(repository).admit(7, 99, 20, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED', remainingPoints: 800 });
  });

  it('fails closed if an active AI Pro period does not have its matching grant yet', async () => {
    const repository = new FakeRepository();
    repository.value = { sourceAuthorized: true, freeTrial: null, aiPro: aiPro({ grantId: null }) };
    const result = await new AiEntitlementService(repository).admit(7, 99, 20, now);
    expect(result).toMatchObject({ source: 'BLOCKED', reason: 'AI_PRO_GRANT_NOT_READY' });
  });

  it('returns AI_PRO and creates a Source scope from the users exact current-period grant', async () => {
    const repository = new FakeRepository();
    repository.value = { sourceAuthorized: true, freeTrial: null, aiPro: aiPro() };
    const result = await new AiEntitlementService(repository).admit(7, 99, 200, now);
    expect(result).toEqual({
      source: 'AI_PRO', allowed: true, reason: 'AI_PRO_AVAILABLE',
      remainingPoints: 800, periodEndsAt: periodEnd.toISOString(), perRequestAiPointCap: 250,
    });
    expect(repository.scopes).toEqual([{ grantId: 22, sourceId: 99 }]);
  });
});
