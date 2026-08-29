import { describe, expect, it } from 'vitest';
import { adExpiry, allocateUserEnergy, hasProactiveCapability } from './model';

describe('user Energy model', () => {
  const at = new Date('2026-08-29T00:00:00Z');

  it('consumes earliest expiry, then FREE, then PAID', () => {
    const result = allocateUserEnergy(
      [
        { id: 1, bucket: 'PAID', availableUnits: 50n, reservedUnits: 0n, expiresAt: null },
        { id: 2, bucket: 'FREE', availableUnits: 20n, reservedUnits: 0n, expiresAt: null },
        { id: 3, bucket: 'SUBSCRIPTION', availableUnits: 10n, reservedUnits: 0n, expiresAt: new Date('2026-09-29T00:00:00Z') },
        { id: 4, bucket: 'AD', availableUnits: 5n, reservedUnits: 0n, expiresAt: new Date('2026-08-30T00:00:00Z') },
      ],
      40n,
      at,
    );
    expect(result.allocations.map((item) => [item.bucket, item.units])).toEqual([
      ['AD', 5n],
      ['SUBSCRIPTION', 10n],
      ['FREE', 20n],
      ['PAID', 5n],
    ]);
    expect(result.covered).toBe(true);
  });

  it('ignores expired lots', () => {
    const result = allocateUserEnergy(
      [{ id: 1, bucket: 'AD', availableUnits: 20n, reservedUnits: 0n, expiresAt: at }],
      1n,
      at,
    );
    expect(result.covered).toBe(false);
  });

  it('unlocks proactive only with usable subscription or paid value', () => {
    expect(hasProactiveCapability([
      { id: 1, bucket: 'FREE', availableUnits: 100n, reservedUnits: 0n, expiresAt: null },
      { id: 2, bucket: 'AD', availableUnits: 100n, reservedUnits: 0n, expiresAt: adExpiry(at) },
    ], at)).toBe(false);
    expect(hasProactiveCapability([
      { id: 3, bucket: 'PAID', availableUnits: 1n, reservedUnits: 0n, expiresAt: null },
    ], at)).toBe(true);
  });
});
