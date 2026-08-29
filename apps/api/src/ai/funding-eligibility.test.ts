import { describe, expect, it, vi } from 'vitest';
import { parseTwdCostUnits } from '../credits/allocation';
import { AiFundingEligibilityService } from './funding-eligibility';

function snapshot(overrides: Partial<{
  welcome: string;
  ad: string;
  paid: string;
  spent: string;
}> = {}) {
  return {
    welcomeAvailableUnits: parseTwdCostUnits(overrides.welcome ?? '1.00000000'),
    adAvailableUnits: parseTwdCostUnits(overrides.ad ?? '0.00000000'),
    paidAvailableUnits: parseTwdCostUnits(overrides.paid ?? '0.00000000'),
    globalFreeAiSpentUnits: parseTwdCostUnits(overrides.spent ?? '0.00000000'),
  };
}

describe('AiFundingEligibilityService', () => {
  it('allows a provider call when free credit and global subsidy remain', async () => {
    const service = new AiFundingEligibilityService(
      { load: vi.fn(async () => snapshot({ welcome: '0.5', spent: '9.75' })) },
      10,
    );

    await expect(service.check(3)).resolves.toMatchObject({
      status: 'ELIGIBLE',
      usableFreeUnits: parseTwdCostUnits('0.25'),
      paidAvailableUnits: 0n,
    });
  });

  it('blocks an unfunded provider call when the global free budget is exhausted', async () => {
    const service = new AiFundingEligibilityService(
      { load: vi.fn(async () => snapshot({ welcome: '0.5', spent: '10' })) },
      10,
    );

    await expect(service.check(3)).resolves.toEqual({
      status: 'FREE_BUDGET_EXHAUSTED',
      usableFreeUnits: 0n,
      paidAvailableUnits: 0n,
      remainingGlobalFreeBudgetUnits: 0n,
    });
  });

  it('still allows paid-funded AI after the free budget is exhausted', async () => {
    const service = new AiFundingEligibilityService(
      { load: vi.fn(async () => snapshot({ welcome: '0.5', paid: '2', spent: '10' })) },
      10,
    );

    await expect(service.check(3)).resolves.toMatchObject({
      status: 'ELIGIBLE',
      usableFreeUnits: 0n,
      paidAvailableUnits: parseTwdCostUnits('2'),
    });
  });

  it('distinguishes no group credit from an exhausted global subsidy', async () => {
    const service = new AiFundingEligibilityService(
      { load: vi.fn(async () => snapshot({ welcome: '0', ad: '0', paid: '0', spent: '10' })) },
      10,
    );

    await expect(service.check(3)).resolves.toEqual({
      status: 'NO_CREDIT',
      usableFreeUnits: 0n,
      paidAvailableUnits: 0n,
      remainingGlobalFreeBudgetUnits: 0n,
    });
  });
});
