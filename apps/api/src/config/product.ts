export type ProductConfigEnv = {
  CONVERSATION_EXTRACTION_MESSAGE_THRESHOLD?: string;
  CONVERSATION_EXTRACTION_CHAR_THRESHOLD?: string;
  CONVERSATION_LARGE_MESSAGE_CHARS?: string;
  WELCOME_FIRST_GROUP_COST_TWD?: string;
  WELCOME_LATER_GROUP_COST_TWD?: string;
  REWARDED_AD_COST_TWD?: string;
  REWARDED_AD_DAILY_LIMIT?: string;
  REWARDED_AD_COOLDOWN_MINUTES?: string;
  UNPAID_RETENTION_DAYS?: string;
  PAID_RETENTION_DAYS?: string;
};

export type ProductConfig = {
  conversation: {
    extractionMessageThreshold: number;
    extractionCharThreshold: number;
    largeMessageChars: number;
  };
  credits: {
    welcomeFirstGroupCostTwd: number;
    welcomeLaterGroupCostTwd: number;
    rewardedAdCostTwd: number;
    rewardedAdDailyLimit: number;
    rewardedAdCooldownMinutes: number;
  };
  retention: {
    unpaidDays: number;
    paidDays: number;
  };
};

export const defaultProductConfig: ProductConfig = {
  conversation: {
    extractionMessageThreshold: 30,
    extractionCharThreshold: 5_000,
    largeMessageChars: 2_000,
  },
  credits: {
    welcomeFirstGroupCostTwd: 1,
    welcomeLaterGroupCostTwd: 0.5,
    rewardedAdCostTwd: 0.01,
    rewardedAdDailyLimit: 5,
    rewardedAdCooldownMinutes: 15,
  },
  retention: {
    unpaidDays: 30,
    paidDays: 365,
  },
};

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeNumber(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

export function resolveProductConfig(env: ProductConfigEnv): ProductConfig {
  return {
    conversation: {
      extractionMessageThreshold: positiveInteger(
        'CONVERSATION_EXTRACTION_MESSAGE_THRESHOLD',
        env.CONVERSATION_EXTRACTION_MESSAGE_THRESHOLD,
        defaultProductConfig.conversation.extractionMessageThreshold,
      ),
      extractionCharThreshold: positiveInteger(
        'CONVERSATION_EXTRACTION_CHAR_THRESHOLD',
        env.CONVERSATION_EXTRACTION_CHAR_THRESHOLD,
        defaultProductConfig.conversation.extractionCharThreshold,
      ),
      largeMessageChars: positiveInteger(
        'CONVERSATION_LARGE_MESSAGE_CHARS',
        env.CONVERSATION_LARGE_MESSAGE_CHARS,
        defaultProductConfig.conversation.largeMessageChars,
      ),
    },
    credits: {
      welcomeFirstGroupCostTwd: nonNegativeNumber(
        'WELCOME_FIRST_GROUP_COST_TWD',
        env.WELCOME_FIRST_GROUP_COST_TWD,
        defaultProductConfig.credits.welcomeFirstGroupCostTwd,
      ),
      welcomeLaterGroupCostTwd: nonNegativeNumber(
        'WELCOME_LATER_GROUP_COST_TWD',
        env.WELCOME_LATER_GROUP_COST_TWD,
        defaultProductConfig.credits.welcomeLaterGroupCostTwd,
      ),
      rewardedAdCostTwd: nonNegativeNumber(
        'REWARDED_AD_COST_TWD',
        env.REWARDED_AD_COST_TWD,
        defaultProductConfig.credits.rewardedAdCostTwd,
      ),
      rewardedAdDailyLimit: positiveInteger(
        'REWARDED_AD_DAILY_LIMIT',
        env.REWARDED_AD_DAILY_LIMIT,
        defaultProductConfig.credits.rewardedAdDailyLimit,
      ),
      rewardedAdCooldownMinutes: positiveInteger(
        'REWARDED_AD_COOLDOWN_MINUTES',
        env.REWARDED_AD_COOLDOWN_MINUTES,
        defaultProductConfig.credits.rewardedAdCooldownMinutes,
      ),
    },
    retention: {
      unpaidDays: positiveInteger(
        'UNPAID_RETENTION_DAYS',
        env.UNPAID_RETENTION_DAYS,
        defaultProductConfig.retention.unpaidDays,
      ),
      paidDays: positiveInteger(
        'PAID_RETENTION_DAYS',
        env.PAID_RETENTION_DAYS,
        defaultProductConfig.retention.paidDays,
      ),
    },
  };
}
