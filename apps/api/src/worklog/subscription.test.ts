import { describe, expect, it } from 'vitest';
import {
  WorklogSubscriptionService,
  addOneCalendarMonth,
  evaluateSubscription,
  type WorklogAiReservationSnapshot,
  type WorklogAiUsageCommit,
  type WorklogPlanSnapshot,
  type WorklogSubscriptionRepository,
  type WorklogSubscriptionSnapshot,
} from './subscription';

class FakeRepository implements WorklogSubscriptionRepository {
  plans = new Map<string, WorklogPlanSnapshot>();
  subscriptions = new Map<number, WorklogSubscriptionSnapshot>();
  reservations = new Map<string, WorklogAiReservationSnapshot>();
  expiredCalls: Array<{ chargedUserId: number; at: Date }> = [];
  commitCalls: Array<{ token: string; usage: WorklogAiUsageCommit }> = [];
  forceReserveFailure = false;

  async getPlan(planCode: string) {
    return this.plans.get(planCode) ?? null;
  }

  async getCurrentSubscription(userId: number) {
    return this.subscriptions.get(userId) ?? null;
  }

  async assignPlan(input: Parameters<WorklogSubscriptionRepository['assignPlan']>[0]) {
    const plan = this.plans.get(input.planCode);
    if (!plan?.enabled) return null;
    const snapshot: WorklogSubscriptionSnapshot = {
      userId: input.userId,
      planCode: input.planCode,
      status: 'ACTIVE',
      source: input.source,
      effectiveAt: input.effectiveAt,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      aiUnitsUsed: 0,
      aiUnitsReserved: 0,
      planEnabled: true,
      aiAllowanceUnits: plan.aiAllowanceUnits,
      capabilities: plan.capabilities,
    };
    this.subscriptions.set(input.userId, snapshot);
    return snapshot;
  }

  async expireStaleAiReservations(chargedUserId: number, at: Date) {
    this.expiredCalls.push({ chargedUserId, at });
    let expired = 0;
    for (const reservation of this.reservations.values()) {
      if (
        reservation.chargedUserId === chargedUserId &&
        reservation.status === 'RESERVED' &&
        reservation.expiresAt.getTime() <= at.getTime()
      ) {
        reservation.status = 'EXPIRED';
        const subscription = this.subscriptions.get(chargedUserId);
        if (subscription) {
          subscription.aiUnitsReserved = Math.max(
            0,
            subscription.aiUnitsReserved - reservation.unitsReserved,
          );
        }
        expired += 1;
      }
    }
    return expired;
  }

  async reserveAiUnitsAtomic(
    input: Parameters<WorklogSubscriptionRepository['reserveAiUnitsAtomic']>[0],
  ) {
    if (this.forceReserveFailure) return null;
    const subscription = this.subscriptions.get(input.chargedUserId);
    if (!subscription) return null;
    if (
      subscription.aiUnitsUsed + subscription.aiUnitsReserved + input.requestedUnits >
      subscription.aiAllowanceUnits
    ) {
      return null;
    }
    subscription.aiUnitsReserved += input.requestedUnits;
    const reservation: WorklogAiReservationSnapshot = {
      token: input.token,
      chargedUserId: input.chargedUserId,
      actorUserId: input.actorUserId,
      sourceId: input.sourceId,
      unitsReserved: input.requestedUnits,
      unitsCommitted: 0,
      status: 'RESERVED',
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      expiresAt: input.expiresAt,
    };
    this.reservations.set(input.token, reservation);
    return reservation;
  }

  async getAiReservation(token: string) {
    return this.reservations.get(token) ?? null;
  }

  async commitAiReservationAtomic(token: string, usage: WorklogAiUsageCommit) {
    this.commitCalls.push({ token, usage });
    const reservation = this.reservations.get(token);
    if (!reservation || (reservation.status !== 'RESERVED' && reservation.status !== 'EXPIRED')) return null;
    const subscription = this.subscriptions.get(reservation.chargedUserId);
    if (!subscription) return null;

    const previousStatus = reservation.status;
    reservation.status = 'COMMITTED';
    reservation.unitsCommitted = usage.actualUnits;
    if (previousStatus === 'RESERVED') subscription.aiUnitsReserved -= reservation.unitsReserved;
    subscription.aiUnitsUsed += usage.actualUnits;
    return reservation;
  }

  async releaseAiReservationAtomic(token: string) {
    const reservation = this.reservations.get(token);
    if (!reservation || reservation.status !== 'RESERVED') return null;
    const subscription = this.subscriptions.get(reservation.chargedUserId);
    if (!subscription) return null;
    reservation.status = 'RELEASED';
    subscription.aiUnitsReserved -= reservation.unitsReserved;
    return reservation;
  }
}

function sub(overrides: Partial<WorklogSubscriptionSnapshot> = {}): WorklogSubscriptionSnapshot {
  return {
    userId: 100,
    planCode: 'SUB1',
    status: 'ACTIVE',
    source: 'PAYMENT',
    effectiveAt: new Date('2026-09-01T00:00:00Z'),
    currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    aiUnitsUsed: 20,
    aiUnitsReserved: 5,
    planEnabled: true,
    aiAllowanceUnits: 100,
    capabilities: { groupCollaboration: true },
    ...overrides,
  };
}

function usage(actualUnits = 3): WorklogAiUsageCommit {
  return {
    actualUnits,
    provider: 'gemini',
    model: 'gemini-test',
    inputTokens: 100,
    outputTokens: 50,
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
    providerCostUsd: 0.00003,
  };
}

describe('subscription entitlement', () => {
  it('subtracts both committed and reserved AI units from remaining quota', () => {
    expect(evaluateSubscription(sub(), new Date('2026-09-02T00:00:00Z'))).toMatchObject({
      status: 'ACTIVE',
      allowanceUnits: 100,
      usedUnits: 20,
      reservedUnits: 5,
      remainingUnits: 75,
    });
  });

  it('rejects disabled plans and expired periods', () => {
    expect(
      evaluateSubscription(sub({ planEnabled: false }), new Date('2026-09-02T00:00:00Z')),
    ).toEqual({ status: 'PLAN_DISABLED', planCode: 'SUB1' });
    expect(evaluateSubscription(sub(), new Date('2026-10-01T00:00:00Z'))).toEqual({
      status: 'PERIOD_EXPIRED',
      planCode: 'SUB1',
    });
  });

  it('clamps monthly cycles correctly for end-of-month dates', () => {
    expect(addOneCalendarMonth(new Date('2026-01-31T12:34:56Z')).toISOString()).toBe(
      '2026-02-28T12:34:56.000Z',
    );
    expect(addOneCalendarMonth(new Date('2028-01-31T12:34:56Z')).toISOString()).toBe(
      '2028-02-29T12:34:56.000Z',
    );
  });
});

describe('plan assignment and collaboration entitlement', () => {
  it('normalizes plan code and creates a one-calendar-month period by default', async () => {
    const repository = new FakeRepository();
    repository.plans.set('SUB1', {
      code: 'SUB1',
      displayName: 'Sub 1',
      enabled: true,
      aiAllowanceUnits: 100,
      capabilities: { groupCollaboration: true },
    });
    const service = new WorklogSubscriptionService(repository);
    const effectiveAt = new Date('2026-01-31T12:00:00Z');

    const result = await service.assignPlan({
      userId: 100,
      planCode: ' sub1 ',
      source: 'ADMIN',
      actor: 'admin',
      effectiveAt,
    });

    expect(result.status).toBe('ASSIGNED');
    if (result.status === 'ASSIGNED') {
      expect(result.subscription.currentPeriodStart.toISOString()).toBe('2026-01-31T12:00:00.000Z');
      expect(result.subscription.currentPeriodEnd?.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    }
  });

  it('requires an actor for manual admin assignments', async () => {
    const repository = new FakeRepository();
    repository.plans.set('SUB1', {
      code: 'SUB1',
      displayName: 'Sub 1',
      enabled: true,
      aiAllowanceUnits: 100,
      capabilities: {},
    });
    const service = new WorklogSubscriptionService(repository);

    await expect(
      service.assignPlan({ userId: 100, planCode: 'SUB1', source: 'ADMIN' }),
    ).rejects.toThrow('admin plan assignment requires actor');
  });

  it('keeps FREE personal-only even if capability JSON is incorrectly enabled', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(
      100,
      sub({ planCode: 'FREE', source: 'FREE', capabilities: { groupCollaboration: true } }),
    );
    const service = new WorklogSubscriptionService(repository);

    await expect(service.checkGroupActivation(100, new Date('2026-09-02T00:00:00Z'))).resolves.toEqual({
      status: 'NOT_ALLOWED',
      reason: 'GROUP_CAPABILITY_DISABLED',
    });
  });
});

describe('atomic AI quota lifecycle', () => {
  it('expires stale holds before reserving and returns balance after the new hold', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 20, aiUnitsReserved: 5 }));
    repository.reservations.set('old', {
      token: 'old',
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: 10,
      unitsReserved: 5,
      unitsCommitted: 0,
      status: 'RESERVED',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-09-02T00:00:00Z'),
    });
    const service = new WorklogSubscriptionService(repository, () => 'new-token');

    const result = await service.reserveAi({
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: 10,
      requestedUnits: 10,
      at: new Date('2026-09-02T00:01:00Z'),
    });

    expect(result).toMatchObject({
      status: 'RESERVED',
      remainingAiUnits: 70,
      reservation: { token: 'new-token', chargedUserId: 100, actorUserId: 200, unitsReserved: 10 },
    });
    expect(repository.expiredCalls).toHaveLength(1);
    expect(repository.subscriptions.get(100)?.aiUnitsReserved).toBe(10);
  });

  it('treats an atomic reserve miss after preflight as quota exhaustion', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 90, aiUnitsReserved: 0 }));
    repository.forceReserveFailure = true;
    const service = new WorklogSubscriptionService(repository, () => 'race-loser');

    await expect(
      service.reserveAi({
        chargedUserId: 100,
        actorUserId: 200,
        requestedUnits: 5,
        at: new Date('2026-09-02T00:01:00Z'),
      }),
    ).resolves.toEqual({ status: 'AI_QUOTA_EXHAUSTED' });
  });

  it('commits usage by moving reserved units to used units', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 20, aiUnitsReserved: 5 }));
    repository.reservations.set('r1', {
      token: 'r1',
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: 10,
      unitsReserved: 5,
      unitsCommitted: 0,
      status: 'RESERVED',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-09-02T00:10:00Z'),
    });
    const service = new WorklogSubscriptionService(repository);

    await expect(service.commitAiUsage('r1', usage(3))).resolves.toMatchObject({
      status: 'COMMITTED',
      reservation: { unitsReserved: 5, unitsCommitted: 3, status: 'COMMITTED' },
    });
    expect(repository.subscriptions.get(100)).toMatchObject({ aiUnitsUsed: 23, aiUnitsReserved: 0 });
  });

  it('records full provider usage even when actual usage exceeds the conservative reservation', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 20, aiUnitsReserved: 5 }));
    repository.reservations.set('r1', {
      token: 'r1',
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: 10,
      unitsReserved: 5,
      unitsCommitted: 0,
      status: 'RESERVED',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-09-02T00:10:00Z'),
    });
    const service = new WorklogSubscriptionService(repository);

    await expect(service.commitAiUsage('r1', usage(6))).resolves.toMatchObject({
      status: 'COMMITTED',
      reservation: { unitsReserved: 5, unitsCommitted: 6, status: 'COMMITTED' },
    });
    expect(repository.commitCalls).toHaveLength(1);
    expect(repository.subscriptions.get(100)).toMatchObject({ aiUnitsUsed: 26, aiUnitsReserved: 0 });
  });

  it('settles a provider-success reservation after expiry without subtracting the hold twice', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 20, aiUnitsReserved: 0 }));
    repository.reservations.set('expired', {
      token: 'expired',
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: 10,
      unitsReserved: 5,
      unitsCommitted: 0,
      status: 'EXPIRED',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-09-02T00:00:00Z'),
    });
    const service = new WorklogSubscriptionService(repository);

    await expect(service.commitAiUsage('expired', usage(6))).resolves.toMatchObject({
      status: 'COMMITTED',
      reservation: { unitsReserved: 5, unitsCommitted: 6, status: 'COMMITTED' },
    });
    expect(repository.subscriptions.get(100)).toMatchObject({ aiUnitsUsed: 26, aiUnitsReserved: 0 });
  });

  it('treats an already committed reservation as an idempotent successful settlement', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 26, aiUnitsReserved: 0 }));
    repository.reservations.set('done', {
      token: 'done',
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: 10,
      unitsReserved: 5,
      unitsCommitted: 6,
      status: 'COMMITTED',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-09-02T00:00:00Z'),
    });
    const service = new WorklogSubscriptionService(repository);

    await expect(service.commitAiUsage('done', usage(6))).resolves.toMatchObject({
      status: 'COMMITTED',
      reservation: { token: 'done', unitsCommitted: 6 },
    });
    expect(repository.commitCalls).toHaveLength(0);
  });

  it('releases unused reservations without consuming quota', async () => {
    const repository = new FakeRepository();
    repository.subscriptions.set(100, sub({ aiUnitsUsed: 20, aiUnitsReserved: 5 }));
    repository.reservations.set('r1', {
      token: 'r1',
      chargedUserId: 100,
      actorUserId: 200,
      sourceId: null,
      unitsReserved: 5,
      unitsCommitted: 0,
      status: 'RESERVED',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-09-02T00:10:00Z'),
    });
    const service = new WorklogSubscriptionService(repository);

    await expect(service.releaseAi('r1')).resolves.toMatchObject({
      status: 'RELEASED',
      reservation: { status: 'RELEASED' },
    });
    expect(repository.subscriptions.get(100)).toMatchObject({ aiUnitsUsed: 20, aiUnitsReserved: 0 });
  });
});
