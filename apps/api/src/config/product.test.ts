import { describe, expect, it } from 'vitest';
import { defaultProductConfig, resolveProductConfig } from './product';

describe('resolveProductConfig', () => {
  it('uses safe defaults without inventing Energy amounts', () => {
    expect(resolveProductConfig({})).toEqual(defaultProductConfig);
    expect(defaultProductConfig.energy).toEqual({
      freeInitialUnits: null,
      subscriptionCycleUnits: null,
      rewardedAdUnits: null,
      paidPacks: { SMALL: null, MEDIUM: null, LARGE: null },
    });
  });

  it('allows deployment configuration to supply Energy products without code constants', () => {
    const config = resolveProductConfig({
      CONVERSATION_EXTRACTION_MESSAGE_THRESHOLD: '40',
      MEMORY_REQUEST_LEASE_SECONDS: '180',
      FREE_INITIAL_ENERGY: '100',
      SUBSCRIPTION_MONTHLY_ENERGY: '1000',
      REWARDED_AD_ENERGY: '20',
      PAID_PACK_SMALL_ENERGY: '500',
      PAID_PACK_MEDIUM_ENERGY: '1200',
      PAID_PACK_LARGE_ENERGY: '3000',
      PAID_RETENTION_DAYS: '400',
    });

    expect(config.conversation.extractionMessageThreshold).toBe(40);
    expect(config.memory.requestLeaseSeconds).toBe(180);
    expect(config.energy.freeInitialUnits).toBe(100n);
    expect(config.energy.subscriptionCycleUnits).toBe(1000n);
    expect(config.energy.rewardedAdUnits).toBe(20n);
    expect(config.energy.paidPacks).toEqual({ SMALL: 500n, MEDIUM: 1200n, LARGE: 3000n });
    expect(config.retention.paidDays).toBe(400);
  });

  it('fails fast on invalid values instead of silently changing product behavior', () => {
    expect(() => resolveProductConfig({ REWARDED_AD_DAILY_LIMIT: '0' })).toThrow(
      'REWARDED_AD_DAILY_LIMIT must be a positive integer',
    );
    expect(() => resolveProductConfig({ FREE_INITIAL_ENERGY: '1.5' })).toThrow(
      'FREE_INITIAL_ENERGY must be a positive integer',
    );
  });
});
