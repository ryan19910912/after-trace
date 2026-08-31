import { describe, expect, it } from 'vitest';
import { addIsoDays, taipeiDate, taipeiTime } from './taipei';

describe('Taipei calendar helpers', () => {
  it('uses Asia/Taipei rather than UTC around midnight', () => {
    expect(taipeiDate(new Date('2026-08-30T15:59:59.000Z'))).toBe('2026-08-30');
    expect(taipeiTime(new Date('2026-08-30T15:59:59.000Z'))).toBe('23:59:59');
    expect(taipeiDate(new Date('2026-08-30T16:00:00.000Z'))).toBe('2026-08-31');
    expect(taipeiTime(new Date('2026-08-30T16:00:00.000Z'))).toBe('00:00:00');
  });
});

describe('addIsoDays', () => {
  it('crosses month and leap-day boundaries using date-only arithmetic', () => {
    expect(addIsoDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addIsoDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addIsoDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('rejects invalid date-only values and fractional day offsets', () => {
    expect(() => addIsoDays('2026-02-30', 1)).toThrow('valid calendar date');
    expect(() => addIsoDays('2026/08/31', 1)).toThrow('YYYY-MM-DD');
    expect(() => addIsoDays('2026-08-31', 1.5)).toThrow('integer');
  });
});
