import { describe, expect, it } from 'vitest';
import { metadataRefreshDue, refreshDueMetadataSources } from './stage';

describe('metadataRefreshDue', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');

  it('bootstraps a source that has no metadata runtime state yet', () => {
    expect(metadataRefreshDue(null, now)).toBe(true);
  });

  it('respects an intentionally inactive source', () => {
    expect(metadataRefreshDue({ active: false, nextAttemptAt: new Date('2026-08-30T23:00:00.000Z') }, now)).toBe(false);
  });

  it('runs only when the persisted next-attempt boundary is due', () => {
    expect(metadataRefreshDue({ active: true, nextAttemptAt: new Date('2026-08-31T00:00:00.000Z') }, now)).toBe(true);
    expect(metadataRefreshDue({ active: true, nextAttemptAt: new Date('2026-08-31T00:15:00.000Z') }, now)).toBe(false);
    expect(metadataRefreshDue({ active: true, nextAttemptAt: null }, now)).toBe(true);
  });
});

describe('refreshDueMetadataSources', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');

  it('isolates one provider failure and continues refreshing other due sources', async () => {
    const calls: string[] = [];
    const result = await refreshDueMetadataSources({
      sourceCodes: ['source-a', 'source-b', 'source-c'],
      now,
      readState: async (sourceCode) => sourceCode === 'source-b'
        ? { active: true, nextAttemptAt: new Date('2026-08-31T00:15:00.000Z') }
        : null,
      syncMetadata: async (sourceCode) => {
        calls.push(`sync:${sourceCode}`);
        if (sourceCode === 'source-a') throw new Error('provider unavailable');
      },
      markSuccess: async (sourceCode) => {
        calls.push(`success:${sourceCode}`);
      },
      markFailure: async (sourceCode) => {
        calls.push(`failure:${sourceCode}`);
        // Failure cadence persistence is deliberately best effort. A provider
        // can fail before its source anchor/runtime row is available.
        throw new Error('runtime unavailable');
      },
    });

    expect(result).toEqual({
      due: 2,
      refreshed: 1,
      failed: 1,
      failedSourceCodes: ['source-a'],
    });
    expect(calls).toEqual([
      'sync:source-a',
      'failure:source-a',
      'sync:source-c',
      'success:source-c',
    ]);
  });

  it('does not hide success-cadence persistence failure', async () => {
    await expect(refreshDueMetadataSources({
      sourceCodes: ['source-a'],
      now,
      readState: async () => null,
      syncMetadata: async () => undefined,
      markSuccess: async () => {
        throw new Error('database unavailable');
      },
      markFailure: async () => undefined,
    })).rejects.toThrow('database unavailable');
  });
});
