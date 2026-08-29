import { describe, expect, it, vi } from 'vitest';
import { LineMessagingPushClient } from '../line/push';
import type {
  ReminderDeliveryRepository,
  ReminderDispatchClaim,
} from './delivery';
import { ReminderDeliveryService } from './delivery';

const claim: ReminderDispatchClaim = {
  reminderId: 10,
  groupId: 20,
  lineGroupId: 'Cgroup',
  message: '記得帶雨傘',
  attemptCount: 2,
  retryKey: '123e4567-e89b-12d3-a456-426614174000',
  retryKeyExpiresAt: new Date('2026-08-30T00:00:00Z'),
};

describe('ReminderDeliveryService', () => {
  it('settles reserved User Energy only after LINE accepts the push', async () => {
    const repository: ReminderDeliveryRepository = {
      claimDue: vi.fn().mockResolvedValueOnce(claim).mockResolvedValueOnce(null),
      authorizeDispatch: vi.fn().mockResolvedValue('AUTHORIZED'),
      releaseForRetry: vi.fn(),
      settleAccepted: vi.fn().mockResolvedValue({ status: 'DELIVERED', reminderId: 10 }),
    };
    const line = {
      push: vi.fn().mockResolvedValue({
        status: 'ACCEPTED' as const,
        deliveryReference: `line-retry:${claim.retryKey}`,
      }),
    };

    const result = await new ReminderDeliveryService(repository, line).deliverDue(
      new Date('2026-08-29T01:00:00Z'),
      2,
    );

    expect(result.delivered).toBe(1);
    expect(result.ownerLeftCancelled).toBe(0);
    expect(repository.settleAccepted).toHaveBeenCalledOnce();
    expect(repository.releaseForRetry).not.toHaveBeenCalled();
  });

  it('does not push when cancellation or a stale fence wins authorization', async () => {
    const repository: ReminderDeliveryRepository = {
      claimDue: vi.fn().mockResolvedValueOnce(claim).mockResolvedValueOnce(null),
      authorizeDispatch: vi.fn().mockResolvedValue('CANCELLED'),
      releaseForRetry: vi.fn(),
      settleAccepted: vi.fn(),
    };
    const line = { push: vi.fn() };

    const result = await new ReminderDeliveryService(repository, line).deliverDue(
      new Date('2026-08-29T01:00:00Z'),
      2,
    );

    expect(result.deferred).toBe(1);
    expect(line.push).not.toHaveBeenCalled();
  });

  it('counts owner-left terminal cancellation and never calls LINE', async () => {
    const repository: ReminderDeliveryRepository = {
      claimDue: vi.fn().mockResolvedValueOnce(claim).mockResolvedValueOnce(null),
      authorizeDispatch: vi.fn().mockResolvedValue('OWNER_LEFT'),
      releaseForRetry: vi.fn(),
      settleAccepted: vi.fn(),
    };
    const line = { push: vi.fn() };

    const result = await new ReminderDeliveryService(repository, line).deliverDue(
      new Date('2026-08-29T01:00:00Z'),
      2,
    );

    expect(result.ownerLeftCancelled).toBe(1);
    expect(result.deferred).toBe(0);
    expect(line.push).not.toHaveBeenCalled();
    expect(repository.settleAccepted).not.toHaveBeenCalled();
  });
});

describe('LineMessagingPushClient', () => {
  it('treats LINE 409 for the same retry key as already accepted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 409 }));
    const client = new LineMessagingPushClient('token', fetchImpl as typeof fetch);

    await expect(client.push('Cgroup', 'hello', claim.retryKey)).resolves.toEqual({
      status: 'ACCEPTED',
      deliveryReference: `line-retry:${claim.retryKey}`,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Line-Retry-Key': claim.retryKey }),
      }),
    );
  });
});
