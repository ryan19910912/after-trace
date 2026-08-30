import { describe, expect, it } from 'vitest';
import { parseAvailabilitySearchQuery } from './query';

describe('parseAvailabilitySearchQuery', () => {
  it('accepts a normalized public search query', () => {
    const result = parseAvailabilitySearchQuery({
      sport: 'badminton',
      date: '2026-08-31',
      start: '18:00',
      end: '22:00',
      district: '大安區',
      limit: '25',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.limit).toBe(25);
    expect(result.data.sport).toBe('badminton');
  });

  it('rejects an inverted time window', () => {
    const result = parseAvailabilitySearchQuery({ start: '22:00', end: '18:00' });
    expect(result.success).toBe(false);
  });

  it('caps the result limit', () => {
    const result = parseAvailabilitySearchQuery({ limit: '101' });
    expect(result.success).toBe(false);
  });
});
