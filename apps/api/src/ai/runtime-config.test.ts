import { describe, expect, it } from 'vitest';
import { resolveAiRuntimeConfig } from './runtime-config';

describe('resolveAiRuntimeConfig', () => {
  it('requires explicit pricing and FX instead of hiding stale cost constants', () => {
    expect(() => resolveAiRuntimeConfig({})).toThrow(
      'GEMINI_INPUT_USD_PER_MILLION_TOKENS is required',
    );
  });

  it('requires an explicit global free-AI budget before billable AI can be enabled', () => {
    expect(() =>
      resolveAiRuntimeConfig({
        GEMINI_INPUT_USD_PER_MILLION_TOKENS: '0.10',
        GEMINI_OUTPUT_USD_PER_MILLION_TOKENS: '0.40',
        USD_TWD_RATE: '31.5',
      }),
    ).toThrow('GLOBAL_FREE_AI_BUDGET_COST_TWD is required');
  });

  it('resolves the confirmed model baseline with runtime cost inputs', () => {
    expect(
      resolveAiRuntimeConfig({
        GEMINI_INPUT_USD_PER_MILLION_TOKENS: '0.10',
        GEMINI_OUTPUT_USD_PER_MILLION_TOKENS: '0.40',
        USD_TWD_RATE: '31.5',
        GLOBAL_FREE_AI_BUDGET_COST_TWD: '100',
      }),
    ).toEqual({
      provider: 'GOOGLE',
      model: 'gemini-2.5-flash-lite',
      pricing: {
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.4,
        usdTwdRate: 31.5,
      },
      globalFreeAiBudgetCostTwd: 100,
    });
  });
});
