import { describe, expect, it } from 'vitest';
import {
  customerPointSettlement,
  FREE_INITIAL_AI_POINTS,
  providerCostToAiPoints,
} from './ai-points';

describe('AI point policy', () => {
  it('freezes the MVP initial grant at 400,000 points', () => {
    expect(FREE_INITIAL_AI_POINTS).toBe(400_000);
  });

  it('converts full provider cost into output-price-equivalent points', () => {
    // $0.0018 total provider cost / $2.50 per 1M output tokens
    // = 720 output-price-equivalent tokens/points.
    expect(providerCostToAiPoints({
      providerCostUsd: 0.0018,
      outputUsdPerMillion: 2.5,
    })).toBe(720);
  });

  it('rounds fractional point consumption upward deterministically', () => {
    expect(providerCostToAiPoints({
      providerCostUsd: 0.000001,
      outputUsdPerMillion: 3,
    })).toBe(1);
  });

  it('floors customer balance at zero and records the overage as platform subsidy', () => {
    expect(customerPointSettlement({
      actualPoints: 1_000,
      eligibleRemainingPoints: 300,
    })).toEqual({
      customerPointsCharged: 300,
      platformSubsidizedPoints: 700,
      remainingPoints: 0,
    });
  });

  it('does not create subsidy when balance covers the request', () => {
    expect(customerPointSettlement({
      actualPoints: 240,
      eligibleRemainingPoints: 1_000,
    })).toEqual({
      customerPointsCharged: 240,
      platformSubsidizedPoints: 0,
      remainingPoints: 760,
    });
  });
});
