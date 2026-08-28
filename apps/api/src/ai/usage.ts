export type BillableAiUsage = {
  groupId: number;
  lineUserId: string | null;
  usageType: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputUsdPerMillionTokens: string;
  outputUsdPerMillionTokens: string;
  costUsd: string;
  usdTwdRate: string;
  costTwd: string;
  chargedCostTwd: string;
  latencyMs: number | null;
  chargeOperationId: number;
  createdAt: Date;
};

export interface AiUsageRepository {
  record(usage: BillableAiUsage): Promise<'RECORDED' | 'ALREADY_RECORDED'>;
}

function nonNegativeSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function boundedText(name: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${name} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

export class AiUsageService {
  constructor(private readonly repository: AiUsageRepository) {}

  record(usage: BillableAiUsage): Promise<'RECORDED' | 'ALREADY_RECORDED'> {
    return this.repository.record({
      ...usage,
      groupId: positiveSafeInteger('groupId', usage.groupId),
      usageType: boundedText('usageType', usage.usageType, 64),
      provider: boundedText('provider', usage.provider, 32),
      model: boundedText('model', usage.model, 128),
      inputTokens: nonNegativeSafeInteger('inputTokens', usage.inputTokens),
      outputTokens: nonNegativeSafeInteger('outputTokens', usage.outputTokens),
      latencyMs:
        usage.latencyMs === null
          ? null
          : nonNegativeSafeInteger('latencyMs', usage.latencyMs),
      chargeOperationId: positiveSafeInteger('chargeOperationId', usage.chargeOperationId),
    });
  }
}
