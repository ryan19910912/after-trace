import { describe, expect, it } from 'vitest';
import {
  PushDeliveryService,
  permanentlyInvalidSubscription,
  retryDelayMs,
  transientHttpStatus,
  type PushDeliveryCandidate,
  type PushDeliveryRepository,
} from './push-delivery';

const baseCandidate: PushDeliveryCandidate = {
  recipientId: 11,
  notificationId: 22,
  userId: 33,
  category: 'SYSTEM',
  title: '系統通知',
  body: '內容',
  deepLink: '/notifications',
  attemptCount: 1,
  preferenceEnabled: true,
  subscriptions: [{
    id: 44,
    endpoint: 'https://push.example/subscription',
    p256dh: 'p256dh',
    auth: 'auth',
  }],
};

class FakeRepository implements PushDeliveryRepository {
  candidate: PushDeliveryCandidate | null = { ...baseCandidate };
  calls: string[] = [];

  async claimPending(): Promise<PushDeliveryCandidate[]> {
    return this.candidate ? [this.candidate] : [];
  }
  async recordSubscriptionSuccess(subscriptionId: number): Promise<void> {
    this.calls.push(`success:${subscriptionId}`);
  }
  async revokeSubscription(subscriptionId: number): Promise<void> {
    this.calls.push(`revoke:${subscriptionId}`);
  }
  async markSent(): Promise<boolean> {
    this.calls.push('sent');
    return true;
  }
  async markSkipped(_recipientId: number, _attemptCount: number, code: string): Promise<boolean> {
    this.calls.push(`skipped:${code}`);
    return true;
  }
  async markFailed(_recipientId: number, _attemptCount: number, code: string): Promise<boolean> {
    this.calls.push(`failed:${code}`);
    return true;
  }
  async reschedule(_recipientId: number, _attemptCount: number, code: string, retryAt: Date): Promise<boolean> {
    this.calls.push(`retry:${code}:${retryAt.toISOString()}`);
    return true;
  }
}

describe('PushDeliveryService', () => {
  it('skips PUSH without touching durable IN_APP state when user preference is disabled', async () => {
    const repository = new FakeRepository();
    repository.candidate = { ...baseCandidate, preferenceEnabled: false };
    const service = new PushDeliveryService(repository, { send: async () => ({ ok: true, status: 201 }) });

    const result = await service.deliverPendingBatch();

    expect(result).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(repository.calls).toEqual(['skipped:PUSH_DISABLED_BY_USER']);
  });

  it('skips when there is no active browser/PWA subscription', async () => {
    const repository = new FakeRepository();
    repository.candidate = { ...baseCandidate, subscriptions: [] };
    const service = new PushDeliveryService(repository, { send: async () => ({ ok: true, status: 201 }) });

    const result = await service.deliverPendingBatch();

    expect(result.skipped).toBe(1);
    expect(repository.calls).toEqual(['skipped:NO_ACTIVE_PUSH_SUBSCRIPTION']);
  });

  it('marks recipient SENT after any active installation accepts the push', async () => {
    const repository = new FakeRepository();
    repository.candidate = {
      ...baseCandidate,
      subscriptions: [
        baseCandidate.subscriptions[0],
        { ...baseCandidate.subscriptions[0], id: 45, endpoint: 'https://push.example/second' },
      ],
    };
    const service = new PushDeliveryService(repository, {
      send: async (subscription) => subscription.endpoint.endsWith('/second')
        ? { ok: false, status: 503 }
        : { ok: true, status: 201 },
    });

    const result = await service.deliverPendingBatch();

    expect(result.sent).toBe(1);
    expect(repository.calls).toEqual(['success:44', 'sent']);
  });

  it('revokes 404/410 subscriptions and records a terminal recipient failure when all are gone', async () => {
    const repository = new FakeRepository();
    const service = new PushDeliveryService(repository, { send: async () => ({ ok: false, status: 410 }) });

    const result = await service.deliverPendingBatch();

    expect(result.failed).toBe(1);
    expect(repository.calls).toEqual(['revoke:44', 'failed:PUSH_SUBSCRIPTIONS_INVALID']);
  });

  it('keeps transient delivery PENDING and schedules a bounded retry', async () => {
    const repository = new FakeRepository();
    const now = new Date('2026-09-07T07:00:00.000Z');
    const service = new PushDeliveryService(
      repository,
      { send: async () => ({ ok: false, status: 503 }) },
      { now: () => now },
    );

    const result = await service.deliverPendingBatch();

    expect(result.rescheduled).toBe(1);
    expect(repository.calls).toEqual(['retry:PUSH_HTTP_503:2026-09-07T07:05:00.000Z']);
  });

  it('fails closed after the configured retry budget is exhausted', async () => {
    const repository = new FakeRepository();
    repository.candidate = { ...baseCandidate, attemptCount: 5 };
    const service = new PushDeliveryService(repository, { send: async () => ({ ok: false, status: 429 }) });

    const result = await service.deliverPendingBatch();

    expect(result.failed).toBe(1);
    expect(repository.calls).toEqual(['failed:PUSH_RETRY_EXHAUSTED']);
  });
});

describe('push delivery classification', () => {
  it('classifies permanent invalid and transient statuses separately', () => {
    expect(permanentlyInvalidSubscription(404)).toBe(true);
    expect(permanentlyInvalidSubscription(410)).toBe(true);
    expect(permanentlyInvalidSubscription(500)).toBe(false);
    expect(transientHttpStatus(429)).toBe(true);
    expect(transientHttpStatus(503)).toBe(true);
    expect(transientHttpStatus(403)).toBe(false);
  });

  it('uses bounded exponential-ish retry delays', () => {
    expect(retryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(retryDelayMs(2)).toBe(15 * 60 * 1000);
    expect(retryDelayMs(99)).toBe(180 * 60 * 1000);
  });
});
