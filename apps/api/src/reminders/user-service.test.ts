import { describe, expect, it, vi } from 'vitest';
import { UserReminderService } from './user-service';

describe('UserReminderService', () => {
  it('passes owner, destination group and Energy reservation to persistence', async () => {
    const create = vi.fn(async () => ({ status: 'CREATED' as const, reminderId: 9 }));
    const service = new UserReminderService({ create, cancel: vi.fn() });
    const at = new Date('2026-08-29T00:00:00Z');
    const scheduledFor = new Date('2026-08-30T00:00:00Z');

    await expect(service.create({
      groupId: 3,
      ownerLineUserId: 'U1',
      requestKey: 'request-1',
      message: '帶雨傘',
      scheduledFor,
      reservationUnits: 5n,
    }, at)).resolves.toEqual({ status: 'CREATED', reminderId: 9 });

    expect(create).toHaveBeenCalledWith({
      groupId: 3,
      ownerLineUserId: 'U1',
      requestKey: 'request-1',
      message: '帶雨傘',
      scheduledFor,
      reservationUnits: 5n,
      at,
    });
  });

  it('rejects past reminders before any Energy reservation attempt', async () => {
    const create = vi.fn();
    const service = new UserReminderService({ create, cancel: vi.fn() });
    expect(() => service.create({
      groupId: 3,
      ownerLineUserId: 'U1',
      requestKey: 'request-1',
      message: '帶雨傘',
      scheduledFor: new Date('2026-08-28T00:00:00Z'),
      reservationUnits: 5n,
    }, new Date('2026-08-29T00:00:00Z'))).toThrow('scheduledFor must be in the future');
    expect(create).not.toHaveBeenCalled();
  });

  it('cancels only through the authenticated owner identity', async () => {
    const cancel = vi.fn(async () => ({ status: 'CANCELLED' as const, reminderId: 9 }));
    const service = new UserReminderService({ create: vi.fn(), cancel });
    const at = new Date('2026-08-29T00:00:00Z');
    await service.cancel({
      groupId: 3,
      reminderId: 9,
      ownerLineUserId: 'U1',
      mutationKey: 'cancel-9',
    }, at);
    expect(cancel).toHaveBeenCalledWith({
      groupId: 3,
      reminderId: 9,
      ownerLineUserId: 'U1',
      mutationKey: 'cancel-9',
      at,
    });
  });
});
