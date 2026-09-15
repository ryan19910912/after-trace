import { describe, expect, it, vi } from 'vitest';
import {
  SubscriptionLifecycleService,
  type SubscriptionLifecycleNotificationPort,
  type SubscriptionLifecycleRepository,
} from './subscription-lifecycle';

const periodStart = new Date('2026-09-01T00:00:00.000Z');
const periodEnd = new Date('2026-10-01T00:00:00.000Z');
const occurredAt = new Date('2026-09-01T00:00:10.000Z');
const planCode = 'AI_PRO_99';

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
  it('normalizes provider and dynamic plan code and emits activation notification', async () => {
    const repo = repository({
      status: 'APPLIED', subscriptionId: 12, userId: 7, planCode, type: 'ACTIVATE', periodStart, periodEnd,
    });
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repo, notify);

    await expect(service.apply({
      provider: ' test-pay ', externalEventKey: 'evt_001', type: 'ACTIVATE',
      userId: 7, planCode: ' ai_pro_99 ', occurredAt, periodStart, periodEnd,
    })).resolves.toMatchObject({ status: 'APPLIED', subscriptionId: 12, planCode });

    expect(repo.apply).toHaveBeenCalledWith(expect.objectContaining({ provider: 'TEST-PAY', planCode }));
    expect(notify.activated).toHaveBeenCalledWith({ userId: 7, subscriptionId: 12, planCode, periodStart, periodEnd });
  });

  it('does not notify again when a duplicate event was previously ignored as stale', async () => {
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repository({ status: 'DUPLICATE', applied: null }), notify);
    await expect(service.apply({
      provider: 'TEST_PAY', externalEventKey: 'evt_duplicate_stale', type: 'RENEW',
      userId: 7, planCode, occurredAt, periodStart, periodEnd,
    })).resolves.toEqual({ status: 'DUPLICATE', applied: null });
    expect(notify.activated).not.toHaveBeenCalled();
    expect(notify.renewed).not.toHaveBeenCalled();
    expect(notify.cancelled).not.toHaveBeenCalled();
  });

  it('replays notification for a duplicate event that was already applied', async () => {
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repository({
      status: 'DUPLICATE',
      applied: { subscriptionId: 12, userId: 7, planCode, type: 'RENEW', periodStart, periodEnd },
    }), notify);
    await service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_retry', type: 'RENEW', userId: 7, planCode, occurredAt, periodStart, periodEnd });
    expect(notify.renewed).toHaveBeenCalledWith({ userId: 7, subscriptionId: 12, planCode, periodStart, periodEnd });
  });

  it('does not notify first-seen stale lifecycle events', async () => {
    const notify = notifications();
    const service = new SubscriptionLifecycleService(repository({ status: 'IGNORED_STALE', userId: 7, planCode, type: 'RENEW' }), notify);
    await expect(service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_old', type: 'RENEW', userId: 7, planCode, occurredAt, periodStart, periodEnd }))
      .resolves.toEqual({ status: 'IGNORED_STALE', userId: 7, planCode, type: 'RENEW' });
    expect(notify.renewed).not.toHaveBeenCalled();
  });

  it('binds future cancellation to its exact billing period', async () => {
    const notify = notifications();
    const repo = repository({ status: 'APPLIED', subscriptionId: 12, userId: 7, planCode, type: 'CANCEL', periodStart, periodEnd });
    const service = new SubscriptionLifecycleService(repo, notify);
    await service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_cancel', type: 'CANCEL', userId: 7, planCode, occurredAt, periodStart, periodEnd });
    expect(notify.cancelled).toHaveBeenCalledWith({ userId: 7, subscriptionId: 12, planCode, periodEnd });
  });

  it('rejects scheduled cancellation without matching billing period start', async () => {
    const repo = repository({ status: 'DUPLICATE', applied: null });
    const service = new SubscriptionLifecycleService(repo, notifications());
    await expect(service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_unsafe_cancel', type: 'CANCEL', userId: 7, planCode, occurredAt, periodEnd }))
      .rejects.toThrow('SUBSCRIPTION_CANCEL_PERIOD_INVALID');
    expect(repo.apply).not.toHaveBeenCalled();
  });

  it('allows explicit immediate cancellation without a scheduled period end', async () => {
    const notify = notifications();
    const repo = repository({ status: 'APPLIED', subscriptionId: 12, userId: 7, planCode, type: 'CANCEL', periodStart, periodEnd: occurredAt });
    const service = new SubscriptionLifecycleService(repo, notify);
    await expect(service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_immediate_cancel', type: 'CANCEL', userId: 7, planCode, occurredAt }))
      .resolves.toMatchObject({ status: 'APPLIED', type: 'CANCEL', planCode });
  });

  it('rejects invalid plan identifiers before repository mutation', async () => {
    const repo = repository({ status: 'DUPLICATE', applied: null });
    const service = new SubscriptionLifecycleService(repo, notifications());
    await expect(service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_bad_plan', type: 'ACTIVATE', userId: 7, planCode: '', occurredAt, periodStart, periodEnd }))
      .rejects.toThrow('SUBSCRIPTION_PLAN_CODE_INVALID');
    expect(repo.apply).not.toHaveBeenCalled();
  });

  it('rejects activation/renewal without a valid paid period', async () => {
    const repo = repository({ status: 'DUPLICATE', applied: null });
    const service = new SubscriptionLifecycleService(repo, notifications());
    await expect(service.apply({ provider: 'TEST_PAY', externalEventKey: 'evt_bad_period', type: 'RENEW', userId: 7, planCode, occurredAt, periodStart: periodEnd, periodEnd: periodStart }))
      .rejects.toThrow('SUBSCRIPTION_PERIOD_INVALID');
    expect(repo.apply).not.toHaveBeenCalled();
  });
});
