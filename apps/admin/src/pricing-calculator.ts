export type PricingRecommendationInput = {
  priceTwd: number;
  targetGrossMarginPercent: number;
  usdTwdRate: number;
  outputUsdPerMillion: number;
};

export type PricingRecommendation = {
  aiBudgetTwd: number;
  aiBudgetUsd: number;
  recommendedPoints: number;
};

/**
 * Planning-only calculator for the frozen customer point definition:
 * 1 AI point = 1 output-price-equivalent token.
 *
 * The recommendation is floored so the suggested allowance does not exceed the
 * Admin-entered direct AI cost budget. It never mutates a plan or historical Grant.
 */
export function calculatePricingRecommendation(input: PricingRecommendationInput): PricingRecommendation | null {
  if (!Number.isFinite(input.priceTwd) || input.priceTwd < 0) return null;
  if (
    !Number.isFinite(input.targetGrossMarginPercent)
    || input.targetGrossMarginPercent < 0
    || input.targetGrossMarginPercent >= 100
  ) return null;
  if (!Number.isFinite(input.usdTwdRate) || input.usdTwdRate <= 0) return null;
  if (!Number.isFinite(input.outputUsdPerMillion) || input.outputUsdPerMillion <= 0) return null;

  const aiBudgetTwd = input.priceTwd * (1 - input.targetGrossMarginPercent / 100);
  const aiBudgetUsd = aiBudgetTwd / input.usdTwdRate;
  const outputUsdPerPoint = input.outputUsdPerMillion / 1_000_000;
  const rawPoints = aiBudgetUsd / outputUsdPerPoint;
  if (!Number.isFinite(rawPoints) || rawPoints < 0) return null;

  return {
    aiBudgetTwd,
    aiBudgetUsd,
    recommendedPoints: Math.max(0, Math.floor(rawPoints)),
  };
}
