import { describe, expect, it, vi } from 'vitest';
import {
  SubscriptionLifecycleService,
  type SubscriptionLifecycleNotificationPort,
  type SubscriptionLifecycleRepository,
} from './subscription-lifecycle';

const periodStart = new Date('2026-09-01T00:00:00.000Z');
const periodEnd = new Date('2026-10-01T00:00:00.000Z');
const occurredAt = new Date('2026-09-01T00:00:10.000Z');

function notifications(): SubscriptionLifecycleNotificationPort {
  return {
    activated: vi.fn().mockResolvedValue(undefined),
    renewed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  };
}

function repository(result: Awaited<ReturnType<SubscriptionLifecycleRepository['apply']>>): SubscriptionLifecycleRepository {
  return { apply: vi.fn().mockResolvedValue(result) };
}

describe('SubscriptionLifecycleService', () => {
  it('normalizes provider event and emits ACTIVATED SYSTEM notification once per applied period', async () => {
    const repo = repository({
      status: 'APPLIED', subscriptionId: 12, userId: 7, type: 'ACTIVATE', periodStart, periodEnd,
    });
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repo, notify);

    await expect(service.apply({
      provider: ' test-pay ', externalEventKey: 'evt_001', type: 'ACTIVATE',
      userId: 7, planCode: 'AI_PRO', occurredAt, periodStart, periodEnd,
    })).resolves.toMatchObject({ status: 'APPLIED', subscriptionId: 12 });

    expect(repo.apply).toHaveBeenCalledWith(expect.objectContaining({ provider: 'TEST-PAY', planCode: 'AI_PRO' }));
    expect(notify.activated).toHaveBeenCalledWith({
      userId: 7, subscriptionId: 12, planCode: 'AI_PRO', periodStart, periodEnd,
    });
    expect(notify.renewed).not.toHaveBeenCalled();
    expect(notify.cancelled).not.toHaveBeenCalled();
  });

  it('does not notify again when a duplicate event was previously ignored as stale', async () => {
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repository({ status: 'DUPLICATE', applied: null }), notify);

    await expect(service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_duplicate_stale', type: 'RENEW',
      userId: 7, planCode: 'AI_PRO', occurredAt, periodStart, periodEnd,
    })).resolves.toEqual({ status: 'DUPLICATE', applied: null });

    expect(notify.activated).not.toHaveBeenCalled();
    expect(notify.renewed).not.toHaveBeenCalled();
    expect(notify.cancelled).not.toHaveBeenCalled();
  });

  it('replays the idempotent SYSTEM notification for a duplicate event that was already applied', async () => {
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repository({
      status: 'DUPLICATE',
      applied: { subscriptionId: 12, userId: 7, type: 'RENEW', periodStart, periodEnd },
    }), notify);

    await expect(service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_retry_after_notify_failure', type: 'RENEW',
      userId: 7, planCode: 'AI_PRO', occurredAt, periodStart, periodEnd,
    })).resolves.toMatchObject({ status: 'DUPLICATE' });

    expect(notify.renewed).toHaveBeenCalledWith({ userId: 7, subscriptionId: 12, periodStart, periodEnd });
    expect(notify.activated).not.toHaveBeenCalled();
    expect(notify.cancelled).not.toHaveBeenCalled();
  });

  it('does not emit SYSTEM notifications for first-seen stale lifecycle events', async () => {
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repository({
      status: 'IGNORED_STALE', userId: 7, type: 'RENEW',
    }), notify);

    await expect(service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_old_renewal', type: 'RENEW',
      userId: 7, planCode: 'AI_PRO', occurredAt, periodStart, periodEnd,
    })).resolves.toEqual({ status: 'IGNORED_STALE', userId: 7, type: 'RENEW' });

    expect(notify.activated).not.toHaveBeenCalled();
    expect(notify.renewed).not.toHaveBeenCalled();
    expect(notify.cancelled).not.toHaveBeenCalled();
  });

  it('treats cancellation with a future period end as cancel-at-period-end semantics', async () => {
    const notify = notifications();
    const repo = repository({
      status: 'APPLIED', subscriptionId: 12, userId: 7, type: 'CANCEL', periodStart, periodEnd,
    });
    const service = new SubscriptionLifecycleService(repo, notify);

    await service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_cancel', type: 'CANCEL',
      userId: 7, planCode: 'AI_PRO', occurredAt, periodEnd,
    });

    expect(notify.cancelled).toHaveBeenCalledWith({ userId: 7, subscriptionId: 12, periodEnd });
  });

  it('rejects non-V1 plans before repository mutation', async () => {
    const repo = repository({ status: 'DUPLICATE', applied: null });
    const service = new SubscriptionLifecycleService(repo, notifications());

    await expect(service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_wrong_plan', type: 'ACTIVATE',
      userId: 7, planCode: 'PRO' as never, occurredAt, periodStart, periodEnd,
    })).rejects.toThrow('V1_ONLY_AI_PRO_SUBSCRIPTION');
    expect(repo.apply).not.toHaveBeenCalled();
  });

  it('rejects activation/renewal without a valid paid period', async () => {
    const repo = repository({ status: 'DUPLICATE', applied: null });
    const service = new SubscriptionLifecycleService(repo, notifications());

    await expect(service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_bad_period', type: 'RENEW',
      userId: 7, planCode: 'AI_PRO', occurredAt, periodStart: periodEnd, periodEnd: periodStart,
    })).rejects.toThrow('SUBSCRIPTION_PERIOD_INVALID');
    expect(repo.apply).not.toHaveBeenCalled();
  });
});
