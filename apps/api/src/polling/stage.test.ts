import { describe, expect, it } from 'vitest';
import { metadataRefreshDue } from './stage';

describe('metadataRefreshDue', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');
  const sixHours = 6 * 60 * 60 * 1000;

  it('refreshes missing or inactive metadata immediately', () => {
    expect(metadataRefreshDue(null, now, sixHours)).toBe(true);
    expect(metadataRefreshDue({ active: false, updatedAt: new Date('2026-08-30T23:59:00.000Z') }, now, sixHours)).toBe(true);
  });

  it('refreshes stale metadata but leaves a recent source snapshot alone', () => {
    expect(metadataRefreshDue({ active: true, updatedAt: new Date('2026-08-30T18:00:00.000Z') }, now, sixHours)).toBe(true);
    expect(metadataRefreshDue({ active: true, updatedAt: new Date('2026-08-30T20:00:00.000Z') }, now, sixHours)).toBe(false);
  });
});
