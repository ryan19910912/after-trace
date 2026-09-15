import { describe, expect, it, vi } from 'vitest';
import { NotificationService, type NotificationRepository, type SystemNotificationInput } from './notifications';
import { notifySubscriptionEvent } from './system-notification-events';

function systemNotificationHarness() {
  const inputs: SystemNotificationInput[] = [];
  const repository = {
    createSystemNotification: vi.fn(async (input: SystemNotificationInput) => {
      inputs.push(input);
      return { notificationId: inputs.length, idempotent: false };
    }),
  } as unknown as NotificationRepository;
  return { inputs, service: new NotificationService(repository) };
}

const planCode = 'AI_PRO_99';

describe('subscription SYSTEM notification event keys', () => {
  it('scopes activation and renewal keys to the paid period', async () => {
    const { inputs, service } = systemNotificationHarness();
    const firstStart = new Date('2026-09-01T00:00:00.000Z');
    const firstEnd = new Date('2026-10-01T00:00:00.000Z');
    const secondStart = new Date('2026-10-01T00:00:00.000Z');
    const secondEnd = new Date('2026-11-01T00:00:00.000Z');

    await notifySubscriptionEvent(service, 7, {
      type: 'ACTIVATED', subscriptionId: 12, planCode, periodStart: firstStart, periodEnd: firstEnd,
    });
    await notifySubscriptionEvent(service, 7, {
      type: 'RENEWED', subscriptionId: 12, planCode, periodStart: secondStart, periodEnd: secondEnd,
    });

    expect(inputs.map((input) => input.eventKey)).toEqual([
      'subscription:12:activated:2026-09-01T00:00:00.000Z',
      'subscription:12:renewed:2026-10-01T00:00:00.000Z',
    ]);
    expect(inputs[0]?.metadata).toMatchObject({ planCode });
    expect(inputs[1]?.metadata).toMatchObject({ planCode });
  });

  it('keeps retry keys stable while allowing cancellation of a later period to be a different event', async () => {
    const { inputs, service } = systemNotificationHarness();
    const firstEnd = new Date('2026-10-01T00:00:00.000Z');
    const secondEnd = new Date('2026-11-01T00:00:00.000Z');

    await notifySubscriptionEvent(service, 7, { type: 'CANCELLED', subscriptionId: 12, planCode, periodEnd: firstEnd });
    await notifySubscriptionEvent(service, 7, { type: 'CANCELLED', subscriptionId: 12, planCode, periodEnd: firstEnd });
    await notifySubscriptionEvent(service, 7, { type: 'CANCELLED', subscriptionId: 12, planCode, periodEnd: secondEnd });

    expect(inputs.map((input) => input.eventKey)).toEqual([
      'subscription:12:cancelled:2026-10-01T00:00:00.000Z',
      'subscription:12:cancelled:2026-10-01T00:00:00.000Z',
      'subscription:12:cancelled:2026-11-01T00:00:00.000Z',
    ]);
  });
});
