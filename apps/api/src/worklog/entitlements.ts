export type PlanCapabilities = {
  privateOaRecording?: boolean;
  aiTextRecording?: boolean;
  aiMediaIngestion?: boolean;
  export?: boolean;
  [key: string]: boolean | number | string | undefined;
};

export type AiPricing = {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  audioUsdPerMillion?: number | null;
  imageUsdPerMillion?: number | null;
  usdTwdRate?: number | null;
};

/**
 * `inputTokens` is the provider-reported total prompt token count.
 * `audioInputUnits` and `imageInputUnits` are modality subsets of that total,
 * not additional units. Provider-cost calculation subtracts those subsets from
 * ordinary input before applying modality-specific prices so the same token is
 * never charged twice.
 */
export type AiMeteredUsage = {
  inputTokens: number;
  outputTokens: number;
  audioInputUnits?: number;
  imageInputUnits?: number;
};

export type AiUsageSnapshot = AiMeteredUsage & {
  provider: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  audioUsdPerMillion: number | null;
  imageUsdPerMillion: number | null;
  usdTwdRate: number | null;
  providerCostUsd: number;
  providerCostTwd: number | null;
};

export function parsePlanCapabilities(value: unknown): PlanCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: PlanCapabilities = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number') {
      result[key] = item;
    }
  }
  return result;
}

export function hasCapability(capabilities: PlanCapabilities, key: string): boolean {
  return capabilities[key] === true;
}

/**
 * Immutable provider-cost snapshot for one AI call.
 *
 * Customer AI eligibility and point consumption do not live in this module. They are
 * handled by user-owned Grant scopes and the AI point ledger. Keeping provider-cost
 * accounting separate prevents plan capabilities from turning back into an aggregate
 * quota or GROUP authorization gate.
 */
export function snapshotAiUsage(pricing: AiPricing, usage: AiMeteredUsage): AiUsageSnapshot {
  const inputTokens = integerAtLeastZero(usage.inputTokens);
  const outputTokens = integerAtLeastZero(usage.outputTokens);
  const audioInputUnits = integerAtLeastZero(usage.audioInputUnits ?? 0);
  const imageInputUnits = integerAtLeastZero(usage.imageInputUnits ?? 0);
  if (audioInputUnits + imageInputUnits > inputTokens) {
    throw new Error('media input units must be subsets of total input tokens');
  }

  const ordinaryInputTokens = inputTokens - audioInputUnits - imageInputUnits;
  const inputUsdPerMillion = finiteAtLeastZero(pricing.inputUsdPerMillion);
  const outputUsdPerMillion = finiteAtLeastZero(pricing.outputUsdPerMillion);
  const audioUsdPerMillion = optionalPrice(pricing.audioUsdPerMillion);
  const imageUsdPerMillion = optionalPrice(pricing.imageUsdPerMillion);
  const usdTwdRate = pricing.usdTwdRate == null ? null : finiteAtLeastZero(pricing.usdTwdRate);

  const providerCostUsd =
    perMillionCost(ordinaryInputTokens, inputUsdPerMillion) +
    perMillionCost(audioInputUnits, audioUsdPerMillion ?? inputUsdPerMillion) +
    perMillionCost(imageInputUnits, imageUsdPerMillion ?? inputUsdPerMillion) +
    perMillionCost(outputTokens, outputUsdPerMillion);

  return {
    provider: pricing.provider,
    model: pricing.model,
    inputTokens,
    outputTokens,
    audioInputUnits,
    imageInputUnits,
    inputUsdPerMillion,
    outputUsdPerMillion,
    audioUsdPerMillion,
    imageUsdPerMillion,
    usdTwdRate,
    providerCostUsd,
    providerCostTwd: usdTwdRate === null ? null : providerCostUsd * usdTwdRate,
  };
}

function perMillionCost(units: number, price: number): number {
  return (units / 1_000_000) * price;
}

function optionalPrice(value: number | null | undefined): number | null {
  return value == null ? null : finiteAtLeastZero(value);
}

function integerAtLeastZero(value: number): number {
  if (!Number.isFinite(value)) throw new Error('usage value must be finite');
  return Math.max(0, Math.floor(value));
}

function finiteAtLeastZero(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('price/rate must be a finite non-negative number');
  return value;
}
