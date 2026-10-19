import { describe, expect, it } from 'vitest';
import {
  aiPointReservationCostHoldTwd,
  customerPointSettlement,
  providerCostToAiPoints,
} from './ai-points';

describe('AI point policy', () => {
  it('converts full provider cost into output-price-equivalent points', () => {
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

  it('converts a point reservation into a conservative TWD provider-cost hold', () => {
    expect(aiPointReservationCostHoldTwd({
      points: 720,
      outputUsdPerMillion: 2.5,
      usdTwdRate: 32,
    })).toBeCloseTo(0.0576, 10);
  });

  it('fails closed at the caller boundary when TWD FX is unavailable', () => {
    expect(aiPointReservationCostHoldTwd({
      points: 720,
      outputUsdPerMillion: 2.5,
      usdTwdRate: null,
    })).toBeNull();
    expect(aiPointReservationCostHoldTwd({
      points: 720,
      outputUsdPerMillion: 2.5,
      usdTwdRate: 0,
    })).toBeNull();
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
