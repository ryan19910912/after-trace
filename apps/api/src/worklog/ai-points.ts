export const FREE_INITIAL_AI_POINTS = 400_000;
export const FREE_INITIAL_GRANT_ORIGIN_KEY = 'FREE_INITIAL:MVP_2026_09';

export type ProviderPointConversionInput = {
  providerCostUsd: number;
  outputUsdPerMillion: number;
};

/**
 * Frozen customer accounting unit:
 *   1 AI point = 1 output-price-equivalent token.
 *
 * Provider cost already includes all billable input/output/thinking/media usage for
 * the immutable pricing snapshot. Divide that total cost by the same snapshot's
 * output-token unit price. Fractional point usage rounds UP so a successful provider
 * request is never silently under-accounted by truncation.
 */
export function providerCostToAiPoints(input: ProviderPointConversionInput): number {
  const providerCostUsd = nonNegativeFinite(input.providerCostUsd, 'providerCostUsd');
  const outputUsdPerMillion = positiveFinite(input.outputUsdPerMillion, 'outputUsdPerMillion');
  if (providerCostUsd === 0) return 0;

  const rawPoints = (providerCostUsd * 1_000_000) / outputUsdPerMillion;
  if (!Number.isFinite(rawPoints) || rawPoints > Number.MAX_SAFE_INTEGER) {
    throw new Error('AI point conversion exceeds safe integer range');
  }
  return Math.ceil(rawPoints);
}

export function customerPointSettlement(input: {
  actualPoints: number;
  eligibleRemainingPoints: number;
}): { customerPointsCharged: number; platformSubsidizedPoints: number; remainingPoints: number } {
  const actual = nonNegativeSafeInteger(input.actualPoints, 'actualPoints');
  const remaining = nonNegativeSafeInteger(input.eligibleRemainingPoints, 'eligibleRemainingPoints');
  const customerPointsCharged = Math.min(actual, remaining);
  return {
    customerPointsCharged,
    platformSubsidizedPoints: actual - customerPointsCharged,
    remainingPoints: remaining - customerPointsCharged,
  };
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}
