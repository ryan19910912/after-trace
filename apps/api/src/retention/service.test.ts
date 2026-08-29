import { describe, expect, it } from 'vitest';
import {
  GroupRetentionService,
  retentionCutoffs,
  type RetentionRepository,
  type RetentionSweepCommand,
} from './service';

class FakeRetentionRepository implements RetentionRepository {
  readonly commands: RetentionSweepCommand[] = [];
  private readonly statuses: Array<'PURGED_ANCHOR_RETAINED' | 'PURGED_GROUP_REMOVED'>;

  constructor(
    statuses: Array<'PURGED_ANCHOR_RETAINED' | 'PURGED_GROUP_REMOVED'>,
    private readonly blocked = 0,
  ) {
    this.statuses = [...statuses];
  }

  async countBlockedDue(command: RetentionSweepCommand): Promise<number> {
    this.commands.push(command);
    return this.blocked;
  }

  async purgeNext(command: RetentionSweepCommand) {
    this.commands.push(command);
    const status = this.statuses.shift();
    if (!status) return null;
    return { status, groupId: this.commands.length };
  }
}

describe('retentionCutoffs', () => {
  it('uses 30 days for never-paid and one calendar year for paid groups', () => {
    const at = new Date('2026-08-29T04:00:00.000Z');
    const cutoffs = retentionCutoffs(at);

    expect(cutoffs.neverPaidBefore.toISOString()).toBe('2026-07-30T04:00:00.000Z');
    expect(cutoffs.paidBefore.toISOString()).toBe('2025-08-29T04:00:00.000Z');
    expect(cutoffs.at).toBe(at);
  });
});

describe('GroupRetentionService', () => {
  it('reports removed groups, retained paid anchors and unresolved reminder blockers', async () => {
    const repository = new FakeRetentionRepository(
      ['PURGED_GROUP_REMOVED', 'PURGED_ANCHOR_RETAINED'],
      3,
    );
    const service = new GroupRetentionService(repository);

    const result = await service.purgeExpired(new Date('2026-08-29T04:00:00.000Z'), 10);

    expect(result).toEqual({
      purged: 2,
      retainedPaidAnchors: 1,
      removedGroups: 1,
      blockedUnresolvedReminders: 3,
    });
  });

  it('rejects an unsafe batch size', async () => {
    const service = new GroupRetentionService(new FakeRetentionRepository([]));
    await expect(service.purgeExpired(new Date(), 101)).rejects.toThrow(
      'limit must be an integer between 1 and 100',
    );
  });
});
