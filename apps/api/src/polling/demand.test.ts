import { describe, expect, it } from 'vitest';
import { watchIntersectsPollingHorizon } from './demand';

describe('watchIntersectsPollingHorizon', () => {
  const today = '2026-08-31';
  const horizonEnd = '2026-09-13';

  it('ignores expired and not-yet-relevant watch windows', () => {
    expect(watchIntersectsPollingHorizon({ dateFrom: null, dateTo: '2026-08-30', daysOfWeek: [] }, today, horizonEnd)).toBe(false);
    expect(watchIntersectsPollingHorizon({ dateFrom: '2026-09-20', dateTo: null, daysOfWeek: [] }, today, horizonEnd)).toBe(false);
  });

  it('activates a future watch once its date window intersects the polling horizon', () => {
    expect(watchIntersectsPollingHorizon({ dateFrom: '2026-09-10', dateTo: '2026-09-20', daysOfWeek: [] }, today, horizonEnd)).toBe(true);
  });

  it('respects day-of-week filters inside the effective date range', () => {
    expect(watchIntersectsPollingHorizon({ dateFrom: '2026-09-05', dateTo: '2026-09-05', daysOfWeek: [6] }, today, horizonEnd)).toBe(true);
    expect(watchIntersectsPollingHorizon({ dateFrom: '2026-09-05', dateTo: '2026-09-05', daysOfWeek: [1] }, today, horizonEnd)).toBe(false);
  });
});
