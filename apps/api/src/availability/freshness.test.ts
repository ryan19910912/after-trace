import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_FRESHNESS_INTERVAL_MULTIPLIER,
  MIN_AVAILABILITY_FRESHNESS_SECONDS,
  availabilityFreshnessSeconds,
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

  it('fails conservatively for invalid interval values', () => {
    expect(availabilityFreshnessSeconds(0)).toBe(2700);
    expect(availabilityFreshnessSeconds(Number.NaN)).toBe(2700);
  });
});
