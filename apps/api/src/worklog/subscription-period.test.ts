import { describe, expect, it } from 'vitest';
import {
  WorklogSubscriptionPeriodService,
  subscriptionPeriodOriginKey,
  type WorklogSubscriptionPeriodGrantSnapshot,
  type WorklogSubscriptionPeriodRepository,
  type WorklogSubscriptionPeriodSnapshot,
  type WorklogSubscriptionPlanTemplate,
} from './subscription-period';

const PRO: WorklogSubscriptionPlanTemplate = {
  code: 'PRO',
  displayName: 'Pro',
  enabled: true,
  priceTwd: 299,
  subscriptionPeriodPoints: 800_000,
};

const FREE: WorklogSubscriptionPlanTemplate = {
  code: 'FREE',
  displayName: 'Free',
  enabled: true,
  priceTwd: 0,
  subscriptionPeriodPoints: 0,
};

const ACTIVE_AT = new Date('2026-09-10T00:00:00.000Z');

class FakeRepository implements WorklogSubscriptionPeriodRepository {
  plans = new Map<string, WorklogSubscriptionPlanTemplate>([[PRO.code, PRO], [FREE.code, FREE]]);
  current: WorklogSubscriptionPeriodSnapshot | null = null;
  privateSourceId: number | null = 42;
  grants = new Map<string, WorklogSubscriptionPeriodGrantSnapshot>();
  assigned: Parameters<WorklogSubscriptionPeriodRepository['assignPeriodAtomic']>[0][] = [];

  async getPlan(planCode: string) {
    return this.plans.get(planCode) ?? null;
  }

  async getCurrentSubscription() {
    return this.current;
  }

  async getPrivateSourceId() {
    return this.privateSourceId;
  }

  async getGrantByOrigin(input: { ownerUserId: number; originKey: string }) {
    void input.ownerUserId;
    return this.grants.get(input.originKey) ?? null;
  }

  async assignPeriodAtomic(input: Parameters<WorklogSubscriptionPeriodRepository['assignPeriodAtomic']>[0]) {
    this.assigned.push(input);
    const subscription: WorklogSubscriptionPeriodSnapshot = {
      userId: input.userId,
      planCode: input.planCode,
      status: 'ACTIVE',
      source: input.source,
      effectiveAt: input.effectiveAt,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      planEnabled: true,
    };
    return {
      subscription,
      grant: input.subscriptionPeriodPoints > 0 && input.originKey
        ? {
            grantId: 77,
            originalPoints: input.subscriptionPeriodPoints,
            remainingPoints: input.subscriptionPeriodPoints,
            effectiveAt: input.currentPeriodStart,
            expiresAt: input.currentPeriodEnd,
            originKey: input.originKey,
          }
        : null,
    };
  }
}

function active(planCode = 'PRO'): WorklogSubscriptionPeriodSnapshot {
  return {
    userId: 1,
    planCode,
    status: 'ACTIVE',
    source: 'ADMIN',
    effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
    currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    planEnabled: true,
  };
}

describe('WorklogSubscriptionPeriodService', () => {
  it('freezes paid period points into one private-scoped grant request', async () => {
    const repository = new FakeRepository();
    const service = new WorklogSubscriptionPeriodService(repository);
    const start = new Date('2026-09-04T00:00:00.000Z');
    const end = new Date('2026-10-04T00:00:00.000Z');

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'pro',
      source: 'ADMIN',
      actor: 'admin',
      at: start,
      effectiveAt: start,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });

    expect(result.status).toBe('ASSIGNED');
    expect(repository.assigned).toHaveLength(1);
    expect(repository.assigned[0]).toMatchObject({
      userId: 1,
      planCode: 'PRO',
      privateSourceId: 42,
      subscriptionPeriodPoints: 800_000,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
    expect(repository.assigned[0]?.originKey).toBe(
      'subscription-period:admin:1:PRO:2026-09-04T00:00:00.000Z',
    );
    expect(repository.assigned[0]?.metadata).toMatchObject({
      grantPolicy: 'SUBSCRIPTION_PERIOD_V1',
      planCode: 'PRO',
      includedAiPoints: 800_000,
      priceTwd: 299,
    });
  });

  it('does not create a recurring grant for FREE', async () => {
    const repository = new FakeRepository();
    const service = new WorklogSubscriptionPeriodService(repository);
    const start = new Date('2026-09-04T00:00:00.000Z');

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'FREE',
      source: 'ADMIN',
      actor: 'admin',
      at: start,
      effectiveAt: start,
      currentPeriodStart: start,
    });

    expect(result.status).toBe('ASSIGNED');
    expect(repository.assigned[0]?.subscriptionPeriodPoints).toBe(0);
    expect(repository.assigned[0]?.originKey).toBeNull();
    expect(repository.assigned[0]?.privateSourceId).toBeNull();
    expect(repository.assigned[0]?.currentPeriodEnd).toBeNull();
  });

  it('treats an exact active-period retry as idempotent only when its frozen grant exists', async () => {
    const repository = new FakeRepository();
    repository.current = active();
    const originKey = subscriptionPeriodOriginKey({
      userId: 1,
      planCode: 'PRO',
      source: 'ADMIN',
      currentPeriodStart: repository.current.currentPeriodStart,
    });
    repository.grants.set(originKey, {
      grantId: 77,
      originalPoints: 800_000,
      remainingPoints: 650_000,
      effectiveAt: repository.current.currentPeriodStart,
      expiresAt: repository.current.currentPeriodEnd,
      originKey,
    });
    const service = new WorklogSubscriptionPeriodService(repository);

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'PRO',
      source: 'ADMIN',
      actor: 'admin',
      at: ACTIVE_AT,
      effectiveAt: ACTIVE_AT,
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'ASSIGNED',
      idempotent: true,
      grant: { grantId: 77, remainingPoints: 650_000 },
    });
    expect(repository.assigned).toHaveLength(0);
  });

  it('does not infer a missing historical grant from an active lifecycle row', async () => {
    const repository = new FakeRepository();
    repository.current = active();
    const service = new WorklogSubscriptionPeriodService(repository);

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'PRO',
      source: 'ADMIN',
      actor: 'admin',
      at: ACTIVE_AT,
      effectiveAt: ACTIVE_AT,
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(result.status).toBe('ACTIVE_PERIOD_EXISTS');
    expect(repository.assigned).toHaveLength(0);
  });

  it('refuses a mid-period plan switch until proration policy is defined', async () => {
    const repository = new FakeRepository();
    repository.plans.set('PLUS', { ...PRO, code: 'PLUS', displayName: 'Plus' });
    repository.current = active('PRO');
    const service = new WorklogSubscriptionPeriodService(repository);

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'PLUS',
      source: 'ADMIN',
      actor: 'admin',
      at: ACTIVE_AT,
      effectiveAt: ACTIVE_AT,
    });

    expect(result.status).toBe('ACTIVE_PERIOD_CHANGE_POLICY_UNDEFINED');
    expect(repository.assigned).toHaveLength(0);
  });

  it('refuses mutating an existing active period under the same plan', async () => {
    const repository = new FakeRepository();
    repository.current = active();
    const service = new WorklogSubscriptionPeriodService(repository);

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'PRO',
      source: 'ADMIN',
      actor: 'admin',
      at: ACTIVE_AT,
      effectiveAt: ACTIVE_AT,
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-15T00:00:00.000Z'),
    });

    expect(result.status).toBe('ACTIVE_PERIOD_EXISTS');
    expect(repository.assigned).toHaveLength(0);
  });

  it('does not create paid period points without a PRIVATE source', async () => {
    const repository = new FakeRepository();
    repository.privateSourceId = null;
    const service = new WorklogSubscriptionPeriodService(repository);

    const result = await service.assignPeriod({
      userId: 1,
      planCode: 'PRO',
      source: 'ADMIN',
      actor: 'admin',
      at: new Date('2026-09-04T00:00:00.000Z'),
      effectiveAt: new Date('2026-09-04T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-09-04T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-04T00:00:00.000Z'),
    });

    expect(result.status).toBe('PRIVATE_SOURCE_NOT_FOUND');
    expect(repository.assigned).toHaveLength(0);
  });
});
