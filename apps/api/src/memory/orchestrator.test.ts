import { describe, expect, it, vi } from 'vitest';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import type { MemoryClassificationInput } from './classification-input';
import type { MemoryClassifierResponse } from './classifier-contract';
import type { ValidatedClassifierResult } from './classifier-result';
import { MemoryAiOrchestrator } from './orchestrator';
import { MemoryAiExecutionError } from './retry-policy';
import type { ClaimedMemoryRequest } from './work';

const now = new Date('2026-08-29T02:00:00Z');
const request: ClaimedMemoryRequest = {
  id: 9,
  groupId: 4,
  origin: 'AUTOMATIC',
  extractionBatchId: 3,
  actorLineUserId: null,
  sourceConversationMessageId: null,
  instruction: null,
  attemptCount: 2,
  transientFailureCount: 0,
  leaseExpiresAt: new Date('2026-08-29T02:02:00Z'),
};
const input: MemoryClassificationInput = {
  requestId: 9,
  groupId: 4,
  origin: 'AUTOMATIC',
  actorLineUserId: null,
  instruction: null,
  currentMessages: [{
    id: 12,
    lineMessageId: 'm12',
    quotedLineMessageId: null,
    lineUserId: 'U1',
    messageType: 'text',
    textContent: '去過東京',
    charCount: 4,
    quoteToken: null,
    lineTimestamp: now,
    metadata: null,
  }],
  previousContext: null,
  activeMemories: [],
  eligibleSubjectLineUserIds: ['U1'],
};
const durable: ValidatedClassifierResult = {
  requestId: 9,
  attemptCount: 1,
  provider: 'GOOGLE',
  model: 'gemini-2.5-flash-lite',
  providerResponseId: 'r1',
  output: {
    candidates: [{
      candidateIndex: 0,
      decision: 'NEW',
      targetMemoryId: null,
      category: 'TRAVEL',
      subject: null,
      content: '去過東京',
      sourceConversationMessageId: 12,
    }],
  },
  inputTokens: 10,
  outputTokens: 5,
  latencyMs: 20,
  inputUsdPerMillionTokens: '0.1000000000',
  outputUsdPerMillionTokens: '0.4000000000',
  usdTwdRate: '32.000000',
  costUsd: '0.0000030000',
  costTwd: '0.00009600',
  createdAt: new Date('2026-08-29T01:59:00Z'),
};
const classifierResponse: MemoryClassifierResponse = {
  output: durable.output,
  tokenUsage: { inputTokens: 10, outputTokens: 5 },
  model: durable.model,
  providerResponseId: 'fresh-response',
  latencyMs: 20,
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

type BillingStatus =
  | 'BILLED'
  | 'INSUFFICIENT_CREDIT'
  | 'FREE_AI_BUDGET_EXHAUSTED'
  | 'CREDIT_REFERENCE_CONFLICT';

function setup(overrides: {
  request?: ClaimedMemoryRequest;
  result?: ValidatedClassifierResult | null;
  billingStatus?: BillingStatus;
  markSucceeded?: boolean;
  classifierError?: unknown;
  staleResultStore?: boolean;
  persist?: ReturnType<typeof vi.fn>;
} = {}) {
  const claimedRequest = overrides.request ?? request;
  const classifier = {
    classify: vi.fn(async () => {
      if (overrides.classifierError) throw overrides.classifierError;
      return classifierResponse;
    }),
  };
  const persist = overrides.persist ?? vi.fn(async (value: { candidate: { candidateIndex: number } }) => ({
    resultId: value.candidate.candidateIndex + 1,
    requestId: claimedRequest.id,
    candidateIndex: value.candidate.candidateIndex,
    decision: 'NEW' as const,
    memoryId: 88 + value.candidate.candidateIndex,
    targetMemoryId: null,
    idempotent: false,
  }));
  const work = {
    claimNextForGroup: vi.fn(async () => claimedRequest),
    markSucceeded: vi.fn(async () => overrides.markSucceeded ?? true),
    markFailed: vi.fn(async () => true),
    deferFailure: vi.fn(async () => true),
    deferTransientFailure: vi.fn(async () => true),
  };
  const results = {
    find: vi.fn(async () => overrides.result === undefined ? durable : overrides.result),
    validateAndStore: vi.fn(async () =>
      overrides.staleResultStore
        ? ({ status: 'STALE_CLAIM' as const })
        : ({ status: 'STORED' as const, result: durable })),
  };
  const billing = {
    chargeAndRecord: vi.fn(async () => {
      switch (overrides.billingStatus) {
        case 'INSUFFICIENT_CREDIT':
          return { status: 'INSUFFICIENT_CREDIT' as const };
        case 'FREE_AI_BUDGET_EXHAUSTED':
          return { status: 'FREE_AI_BUDGET_EXHAUSTED' as const };
        case 'CREDIT_REFERENCE_CONFLICT':
          return { status: 'CREDIT_REFERENCE_CONFLICT' as const };
        default:
          return { status: 'BILLED' as const };
      }
    }),
  };
  const service = new MemoryAiOrchestrator(
    work,
    { load: vi.fn(async () => input) },
    classifier,
    results,
    billing,
    { persist },
    runtime,
  );
  return { service, classifier, persist, work, billing, results };
}

describe('MemoryAiOrchestrator', () => {
  it('reuses a durable classifier result and bills through the adapter contract', async () => {
    const { service, classifier, persist, work, billing } = setup();
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'SUCCEEDED',
      requestId: 9,
      candidateCount: 1,
      reusedClassifierResult: true,
    });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(billing.chargeAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ costTwd: '0.00009600' }),
      { type: 'AI_MEMORY_CLASSIFIER', id: '9' },
      now,
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(work.markSucceeded).toHaveBeenCalledWith(9, 2, now);
  });

  it('keeps the durable result and defers settlement when Energy is insufficient', async () => {
    const { service, classifier, persist, work } = setup({ billingStatus: 'INSUFFICIENT_CREDIT' });
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'WAITING_FOR_CREDIT', requestId: 9,
    });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(work.deferFailure).toHaveBeenCalledWith(
      9, 2, new Date('2026-08-29T02:01:00Z'), 'AI_INSUFFICIENT_CREDIT',
    );
  });

  it('keeps the durable result when the global subsidy budget is exhausted', async () => {
    const { service, persist, work } = setup({ billingStatus: 'FREE_AI_BUDGET_EXHAUSTED' });
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'WAITING_FOR_FREE_BUDGET', requestId: 9,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(work.deferFailure).toHaveBeenCalledWith(
      9, 2, new Date('2026-08-29T02:01:00Z'), 'AI_FREE_BUDGET_EXHAUSTED',
    );
  });

  it('does not bill when the first durable result store loses the claim fence', async () => {
    const { service, billing, persist, work } = setup({ result: null, staleResultStore: true });
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'STALE_CLAIM', requestId: 9,
    });
    expect(billing.chargeAndRecord).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(work.markSucceeded).not.toHaveBeenCalled();
  });

  it('classifies provider configuration failures as terminal', async () => {
    const { service, work } = setup({
      result: null,
      classifierError: new MemoryAiExecutionError('AI_AUTH_INVALID', false),
    });
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({
      status: 'FAILED', requestId: 9, errorCode: 'AI_AUTH_INVALID',
    });
    expect(work.markFailed).toHaveBeenCalled();
  });
});
