import { describe, expect, it } from 'vitest';
import {
  canConsumeAiUnits,
  canUseGroupCollaboration,
  parsePlanCapabilities,
  remainingAiAllowance,
  snapshotAiUsage,
} from './entitlements';

describe('worklog plan entitlements', () => {
  it('keeps FREE personal-only even if a bad capability payload enables collaboration', () => {
    expect(canUseGroupCollaboration('FREE', { groupCollaboration: true })).toBe(false);
  });

  it('requires an explicit paid collaboration capability', () => {
    expect(canUseGroupCollaboration('SUB1', { groupCollaboration: true })).toBe(true);
    expect(canUseGroupCollaboration('SUB1', {})).toBe(false);
  });

  it('sanitizes capability JSON and ignores nested values', () => {
    expect(parsePlanCapabilities({ groupCollaboration: true, maxGroupCount: 2, nested: { bad: true } })).toEqual({
      groupCollaboration: true,
      maxGroupCount: 2,
    });
  });
});

describe('worklog AI allowance', () => {
  it('returns remaining bounded allowance and prevents over-consumption', () => {
    expect(remainingAiAllowance(100, 35)).toBe(65);
    expect(remainingAiAllowance(100, 150)).toBe(0);
    expect(canConsumeAiUnits(100, 35, 65)).toBe(true);
    expect(canConsumeAiUnits(100, 35, 66)).toBe(false);
  });
});

describe('worklog AI pricing snapshot', () => {
  it('prices media modality subsets exactly once while retaining total prompt tokens', () => {
    const pricing = {
      provider: 'gemini',
      model: 'model-a',
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      audioUsdPerMillion: 3,
      imageUsdPerMillion: 4,
      usdTwdRate: 32,
    };

    const snapshot = snapshotAiUsage(pricing, {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      audioInputUnits: 100_000,
      imageInputUnits: 50_000,
    });

    // 850k ordinary @ $1 + 100k audio @ $3 + 50k image @ $4 + 500k output @ $2.
    expect(snapshot.providerCostUsd).toBeCloseTo(2.35, 8);
    expect(snapshot.providerCostTwd).toBeCloseTo(75.2, 8);
    expect(snapshot.inputTokens).toBe(1_000_000);
    expect(snapshot.audioInputUnits).toBe(100_000);
    expect(snapshot.imageInputUnits).toBe(50_000);
    expect(snapshot.model).toBe('model-a');
    expect(snapshot.inputUsdPerMillion).toBe(1);

    pricing.model = 'model-b';
    pricing.inputUsdPerMillion = 9;
    expect(snapshot.model).toBe('model-a');
    expect(snapshot.inputUsdPerMillion).toBe(1);
  });

  it('falls back to the ordinary input rate when a modality-specific price is not configured', () => {
    const snapshot = snapshotAiUsage({
      provider: 'gemini',
      model: 'model-a',
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      audioUsdPerMillion: null,
      imageUsdPerMillion: null,
    }, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      audioInputUnits: 200_000,
      imageInputUnits: 300_000,
    });

    expect(snapshot.providerCostUsd).toBeCloseTo(1, 8);
  });

  it('rejects modality subsets larger than the provider total prompt token count', () => {
    expect(() => snapshotAiUsage({
      provider: 'gemini',
      model: 'bad-usage',
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 1,
    }, {
      inputTokens: 10,
      outputTokens: 1,
      audioInputUnits: 8,
      imageInputUnits: 5,
    })).toThrow(/subsets/);
  });

  it('rejects negative prices instead of silently creating invalid cost data', () => {
    expect(() => snapshotAiUsage({
      provider: 'gemini',
      model: 'bad',
      inputUsdPerMillion: -1,
      outputUsdPerMillion: 1,
    }, { inputTokens: 1, outputTokens: 1 })).toThrow(/price\/rate/);
  });
});
