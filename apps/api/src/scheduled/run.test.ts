import { describe, expect, it } from 'vitest';
import { ScheduledRadarRunner } from './run';

const pollingOk = {
  bootstrappedMetadata: false,
  claimed: 2,
  succeeded: 2,
  failed: 0,
};

const radarOk = {
  eventsProcessed: 3,
  deliveriesCreated: 1,
};

const pushOk = {
  configured: true,
  expired: 0,
  due: 1,
  claimed: 1,
  accepted: 1,
  retried: 0,
  failed: 0,
  gone: 0,
  settlementLost: 0,
  waitingForSubscription: 0,
};

describe('ScheduledRadarRunner', () => {
  it('runs polling, radar matching and push when every stage succeeds', async () => {
    const calls: string[] = [];
    const runner = new ScheduledRadarRunner(
      { async run() { calls.push('polling'); return pollingOk; } },
      { async matchPendingAvailableEvents() { calls.push('radar'); return radarOk; } },
      { async run() { calls.push('push'); return pushOk; } },
    );

    await expect(runner.run()).resolves.toEqual({
      polling: pollingOk,
      radar: radarOk,
      push: pushOk,
      failures: [],
    });
    expect(calls).toEqual(['polling', 'radar', 'push']);
  });

  it('continues with persisted Radar work and Push when polling fails', async () => {
    const calls: string[] = [];
    const runner = new ScheduledRadarRunner(
      { async run() { calls.push('polling'); throw Object.assign(new Error('source unavailable'), { code: 'SOURCE_UNAVAILABLE' }); } },
      { async matchPendingAvailableEvents() { calls.push('radar'); return radarOk; } },
      { async run() { calls.push('push'); return pushOk; } },
    );

    await expect(runner.run()).resolves.toEqual({
      polling: null,
      radar: radarOk,
      push: pushOk,
      failures: [{ stage: 'polling', errorCode: 'SOURCE_UNAVAILABLE' }],
    });
    expect(calls).toEqual(['polling', 'radar', 'push']);
  });

  it('still dispatches already-created Push work when Radar matching fails', async () => {
    const runner = new ScheduledRadarRunner(
      { async run() { return pollingOk; } },
      { async matchPendingAvailableEvents() { throw new Error('database detail that must not leak'); } },
      { async run() { return pushOk; } },
    );

    const result = await runner.run();

    expect(result.polling).toEqual(pollingOk);
    expect(result.radar).toBeNull();
    expect(result.push).toEqual(pushOk);
    expect(result.failures).toEqual([{ stage: 'radar', errorCode: 'SCHEDULED_STAGE_FAILED' }]);
  });

  it('records all failures without throwing so the next cron wake-up can retry', async () => {
    const runner = new ScheduledRadarRunner(
      { async run() { throw new Error('POLLING_FAILED'); } },
      { async matchPendingAvailableEvents() { throw new Error('RADAR_FAILED'); } },
      { async run() { throw new Error('PUSH_FAILED'); } },
    );

    await expect(runner.run()).resolves.toEqual({
      polling: null,
      radar: null,
      push: null,
      failures: [
        { stage: 'polling', errorCode: 'POLLING_FAILED' },
        { stage: 'radar', errorCode: 'RADAR_FAILED' },
        { stage: 'push', errorCode: 'PUSH_FAILED' },
      ],
    });
  });
});
