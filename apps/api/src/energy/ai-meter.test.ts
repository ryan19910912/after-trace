import { describe, expect, it } from 'vitest';
import { aiCostTwdToEnergyUnits, resolveAiEnergyMeter } from './ai-meter';

describe('AI Energy meter', () => {
  it('requires an explicit product conversion instead of guessing', () => {
    expect(() => resolveAiEnergyMeter({})).toThrow('ENERGY_UNITS_PER_TWD is required');
  });

  it('rounds positive provider cost upward to whole Energy units', () => {
    const meter = resolveAiEnergyMeter({ ENERGY_UNITS_PER_TWD: '100' });
    expect(aiCostTwdToEnergyUnits('0.001', meter)).toBe(1n);
    expect(aiCostTwdToEnergyUnits('0.019', meter)).toBe(2n);
  });

  it('keeps zero-cost calls at zero units', () => {
    expect(aiCostTwdToEnergyUnits('0', { energyUnitsPerTwd: 100 })).toBe(0n);
  });
});
