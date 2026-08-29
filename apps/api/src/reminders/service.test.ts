import { describe, expect, it, vi } from 'vitest';
import type { ReminderRepository } from './service';
import { ReminderService } from './service';

function repository(): ReminderRepository {
  return {
    create: vi.fn(async () => ({ status: 'CREATED' as const, reminderId: 11 })),
    cancel: vi.fn(async () => ({ status: 'CANCELLED' as const, reminderId: 11 })),
    settleSuccessfulDelivery: vi.fn(async () => ({ status: 'DELIVERED' as const, reminderId: 11 })),
  };
}

describe('ReminderService', () => {
  it('normalizes creation identity while preserving explicit cost and schedule', async () => {
    const repo = repository();
    const service = new ReminderService(repo);
    const scheduledFor = new Date('2026-08-30T02:00:00Z');
    const at = new Date('2026-08-29T04:00:00Z');

    await service.create(
      {
        groupId: 7,
        requestKey: ' request-7 ',
        message: '  記得帶雨傘  ',
        scheduledFor,
        reservedCostUnits: 25_000n,
        actorLineUserId: ' U123 ',
      },
      at,
    );

    expect(repo.create).toHaveBeenCalledWith({
      groupId: 7,
      requestKey: 'request-7',
      message: '記得帶雨傘',
      scheduledFor,
      reservedCostUnits: 25_000n,
      actorLineUserId: 'U123',
      at,
    });
  });

  it('requires a positive explicit reservation cost instead of inventing reminder pricing', async () => {
    const repo = repository();
    const service = new ReminderService(repo);

    await expect(
      service.create({
        groupId: 1,
        requestKey: 'r-1',
        message: 'test',
        scheduledFor: new Date('2026-08-30T02:00:00Z'),
        reservedCostUnits: 0n,
        actorLineUserId: 'U1',
      }),
    ).rejects.toThrow('reservedCostUnits');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('passes cancellation actor attribution to the atomic repository boundary', async () => {
    const repo = repository();
    const service = new ReminderService(repo);
    const at = new Date('2026-08-29T04:00:00Z');

    await service.cancel(8, 21, ' U9 ', at);

    expect(repo.cancel).toHaveBeenCalledWith({
      groupId: 8,
      reminderId: 21,
      actorLineUserId: 'U9',
      at,
    });
  });

  it('requires a delivery reference before consuming a paid reservation', async () => {
    const repo = repository();
    const service = new ReminderService(repo);

    await expect(
      service.settleSuccessfulDelivery(8, 21, '   '),
    ).rejects.toThrow('deliveryReference');
    expect(repo.settleSuccessfulDelivery).not.toHaveBeenCalled();
  });
});
