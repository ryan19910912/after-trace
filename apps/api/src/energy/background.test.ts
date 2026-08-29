import { describe, expect, it } from 'vitest';
import { allocateBackgroundCharge, backgroundPreflight } from './background';

describe('background Energy allocation', () => {
  it('skips before AI when no speaking participant has Energy', () => {
    expect(backgroundPreflight([
      { lineUserId: 'Ryan', normalizedCharCount: 0, availableEnergyUnits: 100n },
      { lineUserId: 'Amber', normalizedCharCount: 50, availableEnergyUnits: 0n },
    ]).status).toBe('SKIP_NO_ELIGIBLE_PARTICIPANT');
  });

  it('allocates only among eligible speaking users', () => {
    expect(allocateBackgroundCharge([
      { lineUserId: 'Ryan', normalizedCharCount: 600, availableEnergyUnits: 100n },
      { lineUserId: 'Amber', normalizedCharCount: 900, availableEnergyUnits: 0n },
      { lineUserId: 'Len', normalizedCharCount: 400, availableEnergyUnits: 100n },
    ], 10n)).toEqual([
      { lineUserId: 'Ryan', allocatedUnits: 6n, userChargeUnits: 6n, platformSubsidyUnits: 0n },
      { lineUserId: 'Len', allocatedUnits: 4n, userChargeUnits: 4n, platformSubsidyUnits: 0n },
    ]);
  });

  it('subsidizes only the final shortfall instead of charging another member', () => {
    expect(allocateBackgroundCharge([
      { lineUserId: 'Ryan', normalizedCharCount: 600, availableEnergyUnits: 1n },
      { lineUserId: 'Len', normalizedCharCount: 400, availableEnergyUnits: 100n },
    ], 10n)).toEqual([
      { lineUserId: 'Ryan', allocatedUnits: 6n, userChargeUnits: 1n, platformSubsidyUnits: 5n },
      { lineUserId: 'Len', allocatedUnits: 4n, userChargeUnits: 4n, platformSubsidyUnits: 0n },
    ]);
  });
});
