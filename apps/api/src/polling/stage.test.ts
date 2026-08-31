import { describe, expect, it } from 'vitest';
import { metadataRefreshDue } from './stage';

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
