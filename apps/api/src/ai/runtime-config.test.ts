import { describe, expect, it } from 'vitest';
import { resolveAiRuntimeConfig } from './runtime-config';

describe('resolveAiRuntimeConfig', () => {
  it('requires explicit pricing and FX instead of hiding stale cost constants', () => {
    expect(() => resolveAiRuntimeConfig({})).toThrow(
      'GEMINI_INPUT_USD_PER_MILLION_TOKENS is required',
    );
  });

  it('resolves the confirmed model baseline with runtime cost inputs', () => {
    expect(
      resolveAiRuntimeConfig({
        GEMINI_INPUT_USD_PER_MILLION_TOKENS: '0.10',
        GEMINI_OUTPUT_USD_PER_MILLION_TOKENS: '0.40',
        USD_TWD_RATE: '31.5',
      }),
    ).toEqual({
      provider: 'GOOGLE',
      model: 'gemini-2.5-flash-lite',
      pricing: {
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.4,
        usdTwdRate: 31.5,
      },
    });
  });
});
