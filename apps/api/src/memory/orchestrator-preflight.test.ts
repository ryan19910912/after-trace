import { describe, expect, it, vi } from 'vitest';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import { MemoryAiOrchestrator } from './orchestrator';

const now = new Date('2026-08-29T03:00:00Z');
const request = {
  id: 9,
  groupId: 4,
  origin: 'AUTOMATIC' as const,
  extractionBatchId: 3,
  actorLineUserId: null,
  sourceConversationMessageId: null,
  instruction: null,
  attemptCount: 2,
  transientFailureCount: 0,
  leaseExpiresAt: new Date('2026-08-29T03:02:00Z'),
};
const runtime: AiRuntimeConfig = {
  provider: 'GOOGLE',
  model: 'gemini-2.5-flash-lite',
  pricing: {
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
    usdTwdRate: 32,
  },
  globalFreeAiBudgetCostTwd: 100,
};

function setup(status: 'NO_CREDIT' | 'FREE_BUDGET_EXHAUSTED') {
  const work = {
    claimNextForGroup: vi.fn(async () => request),
    markSucceeded: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    deferFailure: vi.fn(async () => true),
    deferTransientFailure: vi.fn(async () => true),
  };
  const load = vi.fn();
  const classify = vi.fn();
  const eligibility = {
    check: vi.fn(async () => status === 'NO_CREDIT'
      ? {
          status: 'NO_CREDIT' as const,
          usableFreeUnits: 0n as const,
          paidAvailableUnits: 0n as const,
          remainingGlobalFreeBudgetUnits: 100n,
        }
      : {
          status: 'FREE_BUDGET_EXHAUSTED' as const,
          usableFreeUnits: 0n as const,
          paidAvailableUnits: 0n as const,
          remainingGlobalFreeBudgetUnits: 0n as const,
        }),
  };
  const service = new MemoryAiOrchestrator(
    work,
    { load },
    { classify },
    { find: vi.fn(async () => null), validateAndStore: vi.fn() },
    { chargeAndRecord: vi.fn() },
    { persist: vi.fn() },
    runtime,
    undefined,
    eligibility,
  );
  return { service, work, load, classify, eligibility };
}

describe('MemoryAiOrchestrator pre-invocation funding gate', () => {
  it('does not load private context or call Gemini when advisory funding is unavailable', async () => {
    const { service, work, load, classify } = setup('NO_CREDIT');
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'WAITING_FOR_CREDIT',
      requestId: 9,
    });
    expect(load).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(work.deferFailure).toHaveBeenCalledWith(
      9,
      2,
      new Date('2026-08-29T03:01:00Z'),
      'AI_INSUFFICIENT_CREDIT',
    );
  });

  it('does not call Gemini when advisory free subsidy is exhausted', async () => {
    const { service, work, classify } = setup('FREE_BUDGET_EXHAUSTED');
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'WAITING_FOR_FREE_BUDGET',
      requestId: 9,
    });
    expect(classify).not.toHaveBeenCalled();
    expect(work.deferFailure).toHaveBeenCalledWith(
      9,
      2,
      new Date('2026-08-29T03:01:00Z'),
      'AI_FREE_BUDGET_EXHAUSTED',
    );
  });

  it('skips advisory eligibility after a durable classifier result already exists', async () => {
    const work = {
      claimNextForGroup: vi.fn(async () => request),
      markSucceeded: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
      deferFailure: vi.fn(async () => true),
      deferTransientFailure: vi.fn(async () => true),
    };
    const eligibility = { check: vi.fn() };
    const durable = {
      requestId: 9,
      attemptCount: 1,
      provider: 'GOOGLE' as const,
      model: 'gemini-2.5-flash-lite',
      providerResponseId: 'r1',
      output: { candidates: [] },
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 20,
      inputUsdPerMillionTokens: '0.1000000000',
      outputUsdPerMillionTokens: '0.4000000000',
      usdTwdRate: '32.000000',
      costUsd: '0.0000030000',
      costTwd: '0.00009600',
      createdAt: now,
    };
    const service = new MemoryAiOrchestrator(
      work,
      { load: vi.fn(async () => ({
        requestId: 9,
        groupId: 4,
        origin: 'AUTOMATIC' as const,
        actorLineUserId: null,
        instruction: null,
        currentMessages: [],
        previousContext: null,
        activeMemories: [],
        eligibleSubjectLineUserIds: ['U1'],
      })) },
      { classify: vi.fn() },
      { find: vi.fn(async () => durable), validateAndStore: vi.fn() },
      { chargeAndRecord: vi.fn(async () => ({ status: 'BILLED' as const })) },
      { persist: vi.fn() },
      runtime,
      undefined,
      eligibility,
    );

    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'SUCCEEDED',
      requestId: 9,
      candidateCount: 0,
      reusedClassifierResult: true,
    });
    expect(eligibility.check).not.toHaveBeenCalled();
  });
});
