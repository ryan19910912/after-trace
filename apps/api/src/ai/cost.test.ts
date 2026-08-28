import { describe, expect, it } from 'vitest';
import { calculateAiCost } from './cost';

describe('calculateAiCost', () => {
  it('uses the pricing and FX snapshot supplied for the usage event', () => {
    const cost = calculateAiCost(
      { inputTokens: 500_000, outputTokens: 250_000 },
      {
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.4,
        usdTwdRate: 32,
      },
    );

    expect(cost.costUsd).toBeCloseTo(0.15, 12);
    expect(cost.costTwd).toBeCloseTo(4.8, 12);
  });

  it('rejects invalid usage rather than producing a negative credit charge', () => {
    expect(() =>
      calculateAiCost(
        { inputTokens: -1, outputTokens: 0 },
        {
          inputUsdPerMillionTokens: 0.1,
          outputUsdPerMillionTokens: 0.4,
          usdTwdRate: 32,
        },
      ),
    ).toThrow('inputTokens must be a non-negative safe integer');
  });
});
