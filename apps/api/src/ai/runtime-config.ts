import type { AiPricingSnapshot } from './cost';

export type AiRuntimeEnv = {
  GEMINI_MODEL?: string;
  GEMINI_INPUT_USD_PER_MILLION_TOKENS?: string;
  GEMINI_OUTPUT_USD_PER_MILLION_TOKENS?: string;
  USD_TWD_RATE?: string;
  GLOBAL_FREE_AI_BUDGET_COST_TWD?: string;
};

export type AiRuntimeConfig = {
  provider: 'GOOGLE';
  model: string;
  pricing: AiPricingSnapshot;
  globalFreeAiBudgetCostTwd: number;
};

export function resolveAiRuntimeConfig(env: AiRuntimeEnv): AiRuntimeConfig {
  return {
    provider: 'GOOGLE',
    model: normalizeModel(env.GEMINI_MODEL),
    pricing: {
      inputUsdPerMillionTokens: requiredPositiveNumber(
        'GEMINI_INPUT_USD_PER_MILLION_TOKENS',
        env.GEMINI_INPUT_USD_PER_MILLION_TOKENS,
      ),
      outputUsdPerMillionTokens: requiredPositiveNumber(
        'GEMINI_OUTPUT_USD_PER_MILLION_TOKENS',
        env.GEMINI_OUTPUT_USD_PER_MILLION_TOKENS,
      ),
      usdTwdRate: requiredPositiveNumber('USD_TWD_RATE', env.USD_TWD_RATE),
    },
    globalFreeAiBudgetCostTwd: requiredPositiveNumber(
      'GLOBAL_FREE_AI_BUDGET_COST_TWD',
      env.GLOBAL_FREE_AI_BUDGET_COST_TWD,
    ),
  };
}

function normalizeModel(value: string | undefined): string {
  const model = value?.trim() || 'gemini-2.5-flash-lite';
  if (model.length > 128) throw new Error('GEMINI_MODEL must be at most 128 characters');
  return model;
}

function requiredPositiveNumber(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required before billable AI can be enabled`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return parsed;
}
