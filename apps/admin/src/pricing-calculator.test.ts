import { describe, expect, it } from 'vitest';
import { calculatePricingRecommendation } from './pricing-calculator';

describe('calculatePricingRecommendation', () => {
  it('uses subscription target margin and output-price-equivalent points', () => {
    expect(calculatePricingRecommendation({
      priceTwd: 99,
      targetGrossMarginPercent: 40,
      usdTwdRate: 33,
      outputUsdPerMillion: 10,
    })).toEqual({
      aiBudgetTwd: 59.4,
      aiBudgetUsd: 1.8,
      recommendedPoints: 180_000,
    });
  });

  it('floors recommended points so the suggestion does not exceed the AI cost budget', () => {
    const result = calculatePricingRecommendation({
      priceTwd: 100,
      targetGrossMarginPercent: 50,
      usdTwdRate: 31,
      outputUsdPerMillion: 10,
    });
    expect(result?.recommendedPoints).toBe(161_290);
  });

  it.each([
    { priceTwd: -1, targetGrossMarginPercent: 40, usdTwdRate: 33, outputUsdPerMillion: 10 },
    { priceTwd: 99, targetGrossMarginPercent: 100, usdTwdRate: 33, outputUsdPerMillion: 10 },
    { priceTwd: 99, targetGrossMarginPercent: 40, usdTwdRate: 0, outputUsdPerMillion: 10 },
    { priceTwd: 99, targetGrossMarginPercent: 40, usdTwdRate: 33, outputUsdPerMillion: 0 },
  ])('fails closed for invalid planning input', (input) => {
    expect(calculatePricingRecommendation(input)).toBeNull();
  });
});
