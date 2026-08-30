import { describe, expect, it } from 'vitest';
import {
  createWatchRuleSchema,
  matchesWatchRule,
  parseIdempotencyKey,
  updateWatchRuleSchema,
} from './rules';

describe('watch rule validation', () => {
  it('normalizes venue/day lists and HH:mm times', () => {
    const parsed = createWatchRuleSchema.parse({
      sport: 'BADMINTON',
      venueIds: [3, 1, 3],
      daysOfWeek: [6, 1, 1],
      startTime: '18:00',
      endTime: '22:00',
    });
    expect(parsed.sport).toBe('badminton');
    expect(parsed.venueIds).toEqual([1, 3]);
    expect(parsed.daysOfWeek).toEqual([1, 6]);
    expect(parsed.startTime).toBe('18:00:00');
    expect(parsed.endTime).toBe('22:00:00');
    expect(parsed.city).toBe('臺北市');
  });

  it('rejects inverted date/time windows', () => {
    expect(createWatchRuleSchema.safeParse({ sport: 'badminton', dateFrom: '2026-09-10', dateTo: '2026-09-01' }).success).toBe(false);
    expect(createWatchRuleSchema.safeParse({ sport: 'badminton', startTime: '22:00', endTime: '18:00' }).success).toBe(false);
  });

  it('accepts partial update payloads and strict idempotency keys', () => {
    expect(updateWatchRuleSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(parseIdempotencyKey('watch-create:1234')).toBe('watch-create:1234');
    expect(parseIdempotencyKey('tiny')).toBeNull();
  });
});

describe('watch matching', () => {
  const event = {
    venueId: 9,
    useDate: '2026-09-05',
    startTime: '19:00:00',
    endTime: '20:00:00',
    city: '臺北市',
    district: '大安區',
  };

  it('matches date/day/time/venue conditions together', () => {
    expect(matchesWatchRule({
      enabled: true,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      daysOfWeek: [6],
      startTime: '18:00:00',
      endTime: '22:00:00',
      city: '臺北市',
      district: '大安區',
      venueIds: [9],
    }, event)).toBe(true);
  });

  it('rejects a non-selected venue or out-of-window slot', () => {
    expect(matchesWatchRule({
      enabled: true,
      dateFrom: null,
      dateTo: null,
      daysOfWeek: [],
      startTime: '20:00:00',
      endTime: null,
      city: '臺北市',
      district: null,
      venueIds: [3],
    }, event)).toBe(false);
  });
});
