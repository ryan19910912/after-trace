export const FREE_INITIAL_GRANT_ORIGIN_KEY = 'FREE_INITIAL';

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

/**
 * Convert a conservative AI-point reservation back to a conservative TWD provider-cost hold.
 * Because point reservation rounds provider cost UP to output-price-equivalent units, converting
 * the reserved points through the same pricing snapshot is never lower than that estimate.
 *
 * A missing/non-positive FX rate intentionally returns null so AI Pro can fail closed before
 * provider execution instead of pretending a TWD hard-cap hold exists.
 */
export function aiPointReservationCostHoldTwd(input: {
  points: number;
  outputUsdPerMillion: number;
  usdTwdRate: number | null;
}): number | null {
  const points = positiveSafeInteger(input.points, 'points');
  const outputUsdPerMillion = positiveFinite(input.outputUsdPerMillion, 'outputUsdPerMillion');
  if (input.usdTwdRate === null || !Number.isFinite(input.usdTwdRate) || input.usdTwdRate <= 0) return null;
  const providerCostTwd = (points * outputUsdPerMillion / 1_000_000) * input.usdTwdRate;
  if (!Number.isFinite(providerCostTwd) || providerCostTwd < 0) {
    throw new Error('AI provider cost hold exceeds finite range');
  }
  return providerCostTwd;
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

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}
