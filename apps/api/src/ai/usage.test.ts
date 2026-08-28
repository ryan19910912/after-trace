import { describe, expect, it, vi } from 'vitest';
import type { AiUsageRepository, BillableAiUsage } from './usage';
import { AiUsageService } from './usage';

const validUsage: BillableAiUsage = {
  groupId: 8,
  lineUserId: 'U123',
  usageType: 'MEMORY_EXTRACTION',
  provider: 'GOOGLE',
  model: 'gemini-2.5-flash-lite',
  inputTokens: 120,
  outputTokens: 30,
  inputUsdPerMillionTokens: '0.1000000000',
  outputUsdPerMillionTokens: '0.4000000000',
  costUsd: '0.0000240000',
  usdTwdRate: '32.000000',
  costTwd: '0.00076800',
  chargedCostTwd: '0.00076800',
  latencyMs: 80,
  chargeOperationId: 99,
  createdAt: new Date('2026-08-29T00:00:00Z'),
};

describe('AiUsageService', () => {
  it('keeps the credit operation id as the idempotency coupling key', async () => {
    const record = vi.fn(async () => 'RECORDED' as const);
    const repository: AiUsageRepository = { record };
    const service = new AiUsageService(repository);

    await expect(service.record(validUsage)).resolves.toBe('RECORDED');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ chargeOperationId: 99 }));
  });

  it('rejects invalid token counts before persistence', async () => {
    const record = vi.fn(async () => 'RECORDED' as const);
    const repository: AiUsageRepository = { record };
    const service = new AiUsageService(repository);

    expect(() => service.record({ ...validUsage, inputTokens: -1 })).toThrow('inputTokens');
    expect(record).not.toHaveBeenCalled();
  });
});
