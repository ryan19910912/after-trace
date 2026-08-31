import { describe, expect, it } from 'vitest';
import { PollingOrchestrator, taipeiDate } from './orchestrator';
import type { PollTargetClaim } from '../sources/sync-repository';

describe('PollingOrchestrator', () => {
  it('claims and syncs already-normalized due targets without owning metadata refresh', async () => {
    const calls: string[] = [];
    const claims: PollTargetClaim[] = [
      { pollTargetId: 1, claimedAt: new Date('2026-08-30T20:30:00.000Z') },
      { pollTargetId: 2, claimedAt: new Date('2026-08-30T20:30:00.000Z') },
    ];
    const repository = {
      async claimDuePollTargets() { calls.push('claim'); return claims; },
    };
    const synchronizer = {
      async syncPollTarget(input: { pollTargetId: number; startDate: string; endDate: string }) {
        calls.push(`poll:${input.pollTargetId}:${input.startDate}:${input.endDate}`);
        return { pollTargetId: input.pollTargetId, datesChecked: 14, bookableDates: 7, slotsSeen: 1, staleSlotsCleared: 0 };
      },
    };
    const now = new Date('2026-08-30T20:30:00.000Z');
    const orchestrator = new PollingOrchestrator(repository, synchronizer, () => now);

    const result = await orchestrator.run();

    expect(result).toEqual({ claimed: 2, succeeded: 2, failed: 0 });
    expect(calls[0]).toBe('claim');
    expect(calls).toContain('poll:1:2026-08-31:2026-09-13');
    expect(calls).toContain('poll:2:2026-08-31:2026-09-13');
  });

  it('returns cleanly when no normalized targets are due and performs no source work', async () => {
    let sourceCalls = 0;
    const repository = {
      async claimDuePollTargets() { return []; },
    };
    const synchronizer = {
      async syncPollTarget() {
        sourceCalls += 1;
        throw new Error('not expected');
      },
    };
    const orchestrator = new PollingOrchestrator(repository, synchronizer, () => new Date('2026-08-31T01:00:00.000Z'));

    const result = await orchestrator.run();

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    expect(sourceCalls).toBe(0);
  });

  it('isolates a failed target so one source failure does not fail the whole cron batch', async () => {
    const repository = {
      async claimDuePollTargets(input: { claimedAt: Date }) {
        return [
          { pollTargetId: 1, claimedAt: input.claimedAt },
          { pollTargetId: 2, claimedAt: input.claimedAt },
        ];
      },
    };
    const synchronizer = {
      async syncPollTarget(input: { pollTargetId: number }) {
        if (input.pollTargetId === 2) throw new Error('source failed');
        return { pollTargetId: input.pollTargetId, datesChecked: 1, bookableDates: 1, slotsSeen: 1, staleSlotsCleared: 0 };
      },
    };
    const orchestrator = new PollingOrchestrator(repository, synchronizer, () => new Date('2026-08-31T01:00:00.000Z'));

    const result = await orchestrator.run({ horizonDays: 1 });

    expect(result).toEqual({ claimed: 2, succeeded: 1, failed: 1 });
  });
});

describe('taipeiDate', () => {
  it('uses Asia/Taipei rather than UTC around midnight', () => {
    expect(taipeiDate(new Date('2026-08-30T16:30:00.000Z'))).toBe('2026-08-31');
  });
});
