import { describe, expect, it } from 'vitest';
import {
  ReminderRecoveryService,
  type ReminderRecoveryCommand,
  type ReminderRecoveryRepository,
  type ReminderRecoveryStatus,
} from './recovery';

class FakeRepository implements ReminderRecoveryRepository {
  command: ReminderRecoveryCommand | null = null;

  constructor(private readonly status: ReminderRecoveryStatus = 'REQUEUED') {}

  async requeueUnresolved(command: ReminderRecoveryCommand): Promise<ReminderRecoveryStatus> {
    this.command = command;
    return this.status;
  }
}

describe('ReminderRecoveryService', () => {
  it('normalizes explicit operator attribution and preserves the retry fence', async () => {
    const repository = new FakeRepository();
    const service = new ReminderRecoveryService(repository);
    const at = new Date('2026-08-29T04:30:00.000Z');

    const status = await service.requeueUnresolved(
      {
        groupId: 3,
        reminderId: 9,
        expectedAttemptCount: 2,
        retryKey: ' 5cfb2a8e-9b0d-4f84-a544-0c03ed6e2134 ',
        operatorRef: ' ops-42 ',
        reason: ' provider timeout confirmed ',
      },
      at,
    );

    expect(status).toBe('REQUEUED');
    expect(repository.command).toEqual({
      groupId: 3,
      reminderId: 9,
      expectedAttemptCount: 2,
      retryKey: '5cfb2a8e-9b0d-4f84-a544-0c03ed6e2134',
      operatorRef: 'ops-42',
      reason: 'provider timeout confirmed',
      at,
    });
  });

  it('rejects recovery without an exact positive attempt fence', () => {
    const service = new ReminderRecoveryService(new FakeRepository());

    expect(() =>
      service.requeueUnresolved({
        groupId: 3,
        reminderId: 9,
        expectedAttemptCount: 0,
        retryKey: '5cfb2a8e-9b0d-4f84-a544-0c03ed6e2134',
        operatorRef: 'ops-42',
        reason: 'retry',
      }),
    ).toThrow('expectedAttemptCount must be a positive safe integer');
  });
});
