import { describe, expect, it } from 'vitest';
import { adminProfitabilityWindow, parseAdminProfitabilityPeriod } from './profitability';

describe('admin profitability reporting period', () => {
  const at = new Date('2026-09-04T07:15:30.000Z'); // 2026-09-04 15:15:30 Asia/Taipei

  it('uses Taipei midnight for TODAY', () => {
    const window = adminProfitabilityWindow('TODAY', at);
    expect(window.period).toBe('TODAY');
    expect(window.from.toISOString()).toBe('2026-09-03T16:00:00.000Z');
    expect(window.to.getTime()).toBe(at.getTime() + 1);
  });

  it('uses Taipei first-of-month midnight for BILLING_MONTH', () => {
    const window = adminProfitabilityWindow('BILLING_MONTH', at);
    expect(window.from.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(window.to.getTime()).toBe(at.getTime() + 1);
  });

  it('uses exact trailing windows for 7D and 30D', () => {
    expect(adminProfitabilityWindow('7D', at).from.toISOString()).toBe('2026-08-28T07:15:30.000Z');
    expect(adminProfitabilityWindow('30D', at).from.toISOString()).toBe('2026-08-05T07:15:30.000Z');
  });

  it('accepts only the documented selectable periods', () => {
    expect(parseAdminProfitabilityPeriod(undefined)).toBe('TODAY');
    expect(parseAdminProfitabilityPeriod('7d')).toBe('7D');
    expect(parseAdminProfitabilityPeriod('30D')).toBe('30D');
    expect(parseAdminProfitabilityPeriod('billing_month')).toBe('BILLING_MONTH');
    expect(parseAdminProfitabilityPeriod('month')).toBeNull();
  });
});
