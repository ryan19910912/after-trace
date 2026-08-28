import { describe, expect, it } from 'vitest';
import { defaultProductConfig, resolveProductConfig } from './product';

describe('resolveProductConfig', () => {
  it('uses the confirmed V1 defaults', () => {
    expect(resolveProductConfig({})).toEqual(defaultProductConfig);
  });

  it('allows deployment configuration to override defaults', () => {
    const config = resolveProductConfig({
      CONVERSATION_EXTRACTION_MESSAGE_THRESHOLD: '40',
      WELCOME_LATER_GROUP_COST_TWD: '0.75',
      PAID_RETENTION_DAYS: '400',
    });

    expect(config.conversation.extractionMessageThreshold).toBe(40);
    expect(config.credits.welcomeLaterGroupCostTwd).toBe(0.75);
    expect(config.retention.paidDays).toBe(400);
  });

  it('fails fast on invalid values instead of silently changing product behavior', () => {
    expect(() => resolveProductConfig({ REWARDED_AD_DAILY_LIMIT: '0' })).toThrow(
      'REWARDED_AD_DAILY_LIMIT must be a positive integer',
    );
  });
});
