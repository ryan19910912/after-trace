import { describe, expect, it } from 'vitest';
import {
  allocateConsumption,
  allocatePaidReservation,
  formatTwdCostUnits,
  parseTwdCostUnits,
  type CreditBalances,
} from './allocation';

function balances(): CreditBalances {
  return {
    WELCOME: { availableUnits: parseTwdCostUnits('0.50000000'), reservedUnits: 0n },
    AD: { availableUnits: parseTwdCostUnits('0.01000000'), reservedUnits: 0n },
    PAID: { availableUnits: parseTwdCostUnits('10.00000000'), reservedUnits: 0n },
  };
}

describe('credit allocation', () => {
  it('consumes WELCOME then AD then PAID', () => {
    const result = allocateConsumption(balances(), parseTwdCostUnits('0.51500000'));

    expect(result.covered).toBe(true);
    expect(result.allocations.map((item) => [item.bucket, formatTwdCostUnits(item.units)])).toEqual([
      ['WELCOME', '0.50000000'],
      ['AD', '0.01000000'],
      ['PAID', '0.00500000'],
    ]);
  });

  it('reports a shortfall instead of silently overdrawing', () => {
    const result = allocateConsumption(balances(), parseTwdCostUnits('20.00000000'));

    expect(result.covered).toBe(false);
    expect(formatTwdCostUnits(result.shortfallUnits)).toBe('9.49000000');
  });

  it('reserves reminders from PAID only', () => {
    const result = allocatePaidReservation(
      balances().PAID,
      parseTwdCostUnits('0.30000000'),
    );

    expect(result).toEqual({
      allocations: [{ bucket: 'PAID', units: parseTwdCostUnits('0.30000000') }],
      covered: true,
      shortfallUnits: 0n,
    });
  });

  it('parses decimal cost exactly to 8 places', () => {
    expect(formatTwdCostUnits(parseTwdCostUnits('1.2345'))).toBe('1.23450000');
  });
});
