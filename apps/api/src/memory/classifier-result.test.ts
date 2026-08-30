import { describe, expect, it, vi } from 'vitest';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import type { MemoryClassificationInput } from './classification-input';
import type { MemoryClassifierResultRepository } from './classifier-result';
import { MemoryClassifierResultService } from './classifier-result';
import type { ClaimedMemoryRequest } from './work';

const request: ClaimedMemoryRequest = {
  id: 10,
  groupId: 2,
  origin: 'AUTOMATIC',
  extractionBatchId: 8,
  actorLineUserId: null,
  sourceConversationMessageId: null,
  instruction: null,
  attemptCount: 3,
  transientFailureCount: 0,
  leaseExpiresAt: new Date('2026-08-29T01:10:00Z'),
};
const classificationInput: MemoryClassificationInput = {
  requestId: 10,
  groupId: 2,
  origin: 'AUTOMATIC',
  actorLineUserId: null,
  instruction: null,
  currentMessages: [{
    id: 41,
    lineMessageId: 'm41',
    quotedLineMessageId: null,
    lineUserId: 'U1',
    messageType: 'text',
    textContent: '我喜歡拉麵',
    charCount: 6,
    quoteToken: null,
    lineTimestamp: new Date('2026-08-29T01:00:00Z'),
    metadata: null,
  }],
  previousContext: null,
  activeMemories: [],
  eligibleSubjectLineUserIds: ['U1'],
};
const runtime: AiRuntimeConfig = {
  provider: 'GOOGLE',
  model: 'gemini-2.5-flash-lite',
  pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.4, usdTwdRate: 32 },
  globalFreeAiBudgetCostTwd: 100,
};

describe('MemoryClassifierResultService', () => {
  it('persists a grounded result with a reproducible pricing snapshot', async () => {
    const storeIfCurrent = vi.fn(async (input: Parameters<MemoryClassifierResultRepository['storeIfCurrent']>[0]) => ({ status: 'STORED' as const, result: input.result }));
    const repository: MemoryClassifierResultRepository = { findByRequestId: vi.fn(async () => null), storeIfCurrent };
    const service = new MemoryClassifierResultService(repository);
    const outcome = await service.validateAndStore({
      request, classificationInput, runtime, createdAt: new Date('2026-08-29T01:00:01Z'),
      response: { model: runtime.model, providerResponseId: 'resp-1', latencyMs: 80, tokenUsage: { inputTokens: 100, outputTokens: 50 }, output: { need_save: true, candidates: [{ candidateIndex: 0, decision: 'NEW', targetMemoryId: null, category: 'FOOD', subject: null, content: '喜歡拉麵', sourceConversationMessageId: 41 }] } },
    });
    expect(outcome.status).toBe('STORED');
    expect(storeIfCurrent).toHaveBeenCalledWith(expect.objectContaining({ requestId: 10, attemptCount: 3, result: expect.objectContaining({ providerResponseId: 'resp-1', inputTokens: 100, usdTwdRate: '32.000000' }) }));
  });

  it('accepts and stores a no-save classifier decision', async () => {
    const storeIfCurrent = vi.fn(async (input: Parameters<MemoryClassifierResultRepository['storeIfCurrent']>[0]) => ({ status: 'STORED' as const, result: input.result }));
    const service = new MemoryClassifierResultService({ findByRequestId: vi.fn(async () => null), storeIfCurrent });
    const outcome = await service.validateAndStore({
      request, classificationInput, runtime,
      response: { model: runtime.model, latencyMs: 1, tokenUsage: { inputTokens: 10, outputTokens: 2 }, output: { need_save: false, candidates: [] } },
    });
    expect(outcome.status).toBe('STORED');
  });

  it('rejects hallucinated source ids before durable storage', async () => {
    const repository: MemoryClassifierResultRepository = { findByRequestId: vi.fn(async () => null), storeIfCurrent: vi.fn() };
    const service = new MemoryClassifierResultService(repository);
    await expect(service.validateAndStore({
      request, classificationInput, runtime,
      response: { model: runtime.model, latencyMs: 1, tokenUsage: { inputTokens: 1, outputTokens: 1 }, output: { need_save: true, candidates: [{ candidateIndex: 0, decision: 'NEW', targetMemoryId: null, category: 'X', subject: null, content: 'X', sourceConversationMessageId: 999 }] } },
    })).rejects.toThrow('outside the current request');
  });
});
