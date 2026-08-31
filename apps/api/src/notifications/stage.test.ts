import { describe, expect, it } from 'vitest';
import { WebPushScheduledStage } from './stage';

const dispatchSummary = {
  configured: true,
  expired: 1,
  due: 2,
  claimed: 2,
  accepted: 1,
  retried: 1,
  failed: 0,
  gone: 0,
  settlementLost: 0,
  waitingForSubscription: 0,
};

describe('WebPushScheduledStage', () => {
  it('invalidates stale intents before dispatching current Push work', async () => {
    const calls: string[] = [];
    const stage = new WebPushScheduledStage(
      {
        async invalidateStalePending() {
          calls.push('reconcile');
          return 3;
        },
      },
      {
        async run() {
          calls.push('dispatch');
          return dispatchSummary;
        },
      },
    );

    await expect(stage.run(new Date('2026-08-31T01:00:00.000Z'))).resolves.toEqual({
      ...dispatchSummary,
      invalidated: 3,
    });
    expect(calls).toEqual(['reconcile', 'dispatch']);
  });

  it('does not send Push when reconciliation cannot establish current delivery state', async () => {
    let dispatched = false;
    const stage = new WebPushScheduledStage(
      {
        async invalidateStalePending() {
          throw new Error('database unavailable');
        },
      },
      {
        async run() {
          dispatched = true;
          return dispatchSummary;
        },
      },
    );

    await expect(stage.run()).rejects.toThrow('database unavailable');
    expect(dispatched).toBe(false);
  });
});
