export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiPricingSnapshot = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  usdTwdRate: number;
};

export type AiCalculatedCost = {
  costUsd: number;
  costTwd: number;
};

function nonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

export function calculateAiCost(
  usage: AiTokenUsage,
  pricing: AiPricingSnapshot,
): AiCalculatedCost {
  if (!Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0) {
    throw new Error('inputTokens must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) {
    throw new Error('outputTokens must be a non-negative safe integer');
  }

  nonNegativeFinite('inputUsdPerMillionTokens', pricing.inputUsdPerMillionTokens);
  nonNegativeFinite('outputUsdPerMillionTokens', pricing.outputUsdPerMillionTokens);
  nonNegativeFinite('usdTwdRate', pricing.usdTwdRate);

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;
  const costUsd = inputCost + outputCost;

  return {
    costUsd,
    costTwd: costUsd * pricing.usdTwdRate,
  };
}
