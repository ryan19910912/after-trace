import { describe, expect, it, vi } from 'vitest';
import type { AiUsageRepository } from './usage';
import { AiBillingService, type AiBillingCreditPort, type UnchargedAiUsage } from './billing';

const usage: UnchargedAiUsage = {
  groupId: 3,
  lineUserId: null,
  usageType: 'MEMORY_EXTRACTION',
  provider: 'GOOGLE',
  model: 'gemini-2.5-flash-lite',
  inputTokens: 10,
  outputTokens: 5,
  inputUsdPerMillionTokens: '0.1000000000',
  outputUsdPerMillionTokens: '0.4000000000',
  costUsd: '0.0000030000',
  usdTwdRate: '32.000000',
  costTwd: '0.00009600',
  chargedCostTwd: '0.00009600',
  latencyMs: 40,
  createdAt: new Date('2026-08-29T00:00:00Z'),
};

describe('AiBillingService', () => {
  it('reuses the idempotent credit operation as the usage persistence key', async () => {
    const consume = vi.fn(async () => ({ status: 'ALREADY_APPLIED' as const, operationId: 77 }));
    const credits: AiBillingCreditPort = { consume };
    const record = vi.fn(async () => 'ALREADY_RECORDED' as const);
    const usageRepository: AiUsageRepository = { record };
    const service = new AiBillingService(credits, usageRepository, 100);

    await expect(
      service.chargeAndRecord(usage, { type: 'AI_USAGE', id: 'gemini-response-1' }),
    ).resolves.toEqual({
      status: 'BILLED',
      operationId: 77,
      usageRecord: 'ALREADY_RECORDED',
    });
    expect(consume).toHaveBeenCalledWith(
      3,
      9_600n,
      { type: 'AI_USAGE', id: 'gemini-response-1' },
      usage.createdAt,
      { globalFreeAiBudgetUnits: 10_000_000_000n },
    );
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ chargeOperationId: 77 }));
  });

  it('does not persist usage when credit is insufficient', async () => {
    const credits: AiBillingCreditPort = {
      consume: vi.fn(async () => ({ status: 'INSUFFICIENT' as const, operationId: null })),
    };
    const record = vi.fn(async () => 'RECORDED' as const);
    const usageRepository: AiUsageRepository = { record };
    const service = new AiBillingService(credits, usageRepository, 100);

    await expect(
      service.chargeAndRecord(usage, { type: 'AI_USAGE', id: 'gemini-response-2' }),
    ).resolves.toEqual({ status: 'INSUFFICIENT_CREDIT' });
    expect(record).not.toHaveBeenCalled();
  });

  it('does not persist usage when the global free-AI subsidy is exhausted', async () => {
    const credits: AiBillingCreditPort = {
      consume: vi.fn(async () => ({ status: 'FREE_BUDGET_EXHAUSTED' as const, operationId: null })),
    };
    const record = vi.fn(async () => 'RECORDED' as const);
    const usageRepository: AiUsageRepository = { record };
    const service = new AiBillingService(credits, usageRepository, 100);

    await expect(
      service.chargeAndRecord(usage, { type: 'AI_USAGE', id: 'gemini-response-3' }),
    ).resolves.toEqual({ status: 'FREE_AI_BUDGET_EXHAUSTED' });
    expect(record).not.toHaveBeenCalled();
  });
});
