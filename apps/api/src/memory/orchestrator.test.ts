import { describe, expect, it, vi } from 'vitest';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import type { MemoryClassificationInput } from './classification-input';
import type { ValidatedClassifierResult } from './classifier-result';
import { MemoryAiOrchestrator } from './orchestrator';
import type { ClaimedMemoryRequest } from './work';

const now = new Date('2026-08-29T02:00:00Z');
const request: ClaimedMemoryRequest = { id: 9, groupId: 4, origin: 'AUTOMATIC', extractionBatchId: 3, actorLineUserId: null, sourceConversationMessageId: null, instruction: null, attemptCount: 2, leaseExpiresAt: new Date('2026-08-29T02:02:00Z') };
const input: MemoryClassificationInput = { requestId: 9, groupId: 4, origin: 'AUTOMATIC', actorLineUserId: null, instruction: null, currentMessages: [{ id: 12, lineMessageId: 'm12', quotedLineMessageId: null, lineUserId: 'U1', messageType: 'text', textContent: '去過東京', quoteToken: null, lineTimestamp: now, metadata: null }], previousContext: null, activeMemories: [] };
const durable: ValidatedClassifierResult = { requestId: 9, attemptCount: 1, provider: 'GOOGLE', model: 'gemini-2.5-flash-lite', providerResponseId: 'r1', output: { candidates: [{ candidateIndex: 0, decision: 'NEW', targetMemoryId: null, category: 'TRAVEL', subject: null, content: '去過東京', sourceConversationMessageId: 12 }] }, inputTokens: 10, outputTokens: 5, latencyMs: 20, inputUsdPerMillionTokens: '0.1000000000', outputUsdPerMillionTokens: '0.4000000000', usdTwdRate: '32.000000', costUsd: '0.0000030000', costTwd: '0.00009600', createdAt: new Date('2026-08-29T01:59:00Z') };
const runtime: AiRuntimeConfig = { provider: 'GOOGLE', model: 'gemini-2.5-flash-lite', pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.4, usdTwdRate: 32 } };

function setup(overrides: { result?: ValidatedClassifierResult | null; billingStatus?: 'BILLED' | 'INSUFFICIENT_CREDIT' } = {}) {
  const classifier = { classify: vi.fn() };
  const persist = vi.fn(async () => ({ resultId: 1, requestId: 9, candidateIndex: 0, decision: 'NEW' as const, memoryId: 88, targetMemoryId: null, idempotent: false }));
  const work = { claimNextForGroup: vi.fn(async () => request), markSucceeded: vi.fn(async () => true), deferFailure: vi.fn(async () => true) };
  const results = { find: vi.fn(async () => overrides.result === undefined ? durable : overrides.result), validateAndStore: vi.fn() };
  const billing = { chargeAndRecord: vi.fn(async () => overrides.billingStatus === 'INSUFFICIENT_CREDIT' ? ({ status: 'INSUFFICIENT_CREDIT' as const }) : ({ status: 'BILLED' as const, operationId: 2, usageRecord: 'RECORDED' as const })) };
  const service = new MemoryAiOrchestrator(work, { load: vi.fn(async () => input) }, classifier, results, billing, { persist }, runtime);
  return { service, classifier, persist, work, billing };
}

describe('MemoryAiOrchestrator', () => {
  it('reuses a durable classifier result and settles without another model call', async () => {
    const { service, classifier, persist, work, billing } = setup();
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({ status: 'SUCCEEDED', requestId: 9, candidateCount: 1, reusedClassifierResult: true });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(billing.chargeAndRecord).toHaveBeenCalledWith(expect.objectContaining({ costTwd: '0.00009600' }), { type: 'AI_MEMORY_CLASSIFIER', id: '9' }, now);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(work.markSucceeded).toHaveBeenCalledWith(9, 2, now);
  });

  it('keeps the durable result and defers settlement when credit is insufficient', async () => {
    const { service, classifier, persist, work } = setup({ billingStatus: 'INSUFFICIENT_CREDIT' });
    await expect(service.runNextForGroup(4, now)).resolves.toEqual({ status: 'WAITING_FOR_CREDIT', requestId: 9 });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(work.deferFailure).toHaveBeenCalledWith(9, 2, new Date('2026-08-29T02:01:00Z'), 'AI_INSUFFICIENT_CREDIT');
  });
});
