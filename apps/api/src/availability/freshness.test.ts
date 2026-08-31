import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER,
  MIN_AVAILABILITY_FRESHNESS_SECONDS,
  availabilityFreshnessSeconds,
  availabilityObservationWasStale,
} from './freshness';

describe('availability freshness policy', () => {
  it('keeps a 15-minute minimum for normal 3-5 minute polling', () => {
    expect(availabilityFreshnessSeconds(180)).toBe(900);
    expect(availabilityFreshnessSeconds(300)).toBe(900);
    expect(MIN_AVAILABILITY_FRESHNESS_SECONDS).toBe(900);
  });

  it('scales to three intervals for slower source limits', () => {
    expect(availabilityFreshnessSeconds(600)).toBe(1800);
    expect(availabilityFreshnessSeconds(1200)).toBe(3600);
    expect(AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER).toBe(3);
  });

  it('falls back to the normal five-minute cadence for invalid interval values', () => {
    expect(availabilityFreshnessSeconds(0)).toBe(900);
    expect(availabilityFreshnessSeconds(Number.NaN)).toBe(900);
  });

  it('treats equality with the freshness boundary as still fresh', () => {
    const lastSeenAt = new Date('2026-08-31T00:00:00.000Z');
    expect(availabilityObservationWasStale(
      lastSeenAt,
      new Date('2026-08-31T00:15:00.000Z'),
      300,
    )).toBe(false);
  });

  it('requires reconfirmation once the observation is older than the freshness allowance', () => {
    const lastSeenAt = new Date('2026-08-31T00:00:00.000Z');
    expect(availabilityObservationWasStale(
      lastSeenAt,
      new Date('2026-08-31T00:15:00.001Z'),
      300,
    )).toBe(true);
    expect(availabilityObservationWasStale(
      lastSeenAt,
      new Date('2026-08-31T01:00:00.001Z'),
      1200,
    )).toBe(true);
  });
});
