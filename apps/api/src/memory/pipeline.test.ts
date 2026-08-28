import { describe, expect, it, vi } from 'vitest';
import { MemoryCandidatePipeline, type MemoryCandidateRepository } from './pipeline';

describe('MemoryCandidatePipeline', () => {
  it('normalizes a NEW candidate before persistence', async () => {
    const persistClassifiedCandidate = vi.fn(async (input) => ({
      resultId: 1,
      requestId: input.requestId,
      candidateIndex: input.candidate.candidateIndex,
      decision: input.candidate.decision,
      memoryId: 99,
      targetMemoryId: null,
      idempotent: false,
    }));
    const repository: MemoryCandidateRepository = {
      listActiveMemories: vi.fn(async () => []),
      persistClassifiedCandidate,
    };
    const pipeline = new MemoryCandidatePipeline(repository);

    await pipeline.persist({
      requestId: 5,
      groupId: 2,
      claimAttemptCount: 1,
      actorLineUserId: 'U1',
      candidate: {
        candidateIndex: 0,
        decision: 'NEW',
        targetMemoryId: null,
        category: '  FOOD  ',
        subject: '  牛肉麵  ',
        content: '  這家很好吃  ',
        sourceConversationMessageId: 33,
      },
    });

    expect(persistClassifiedCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: {
          candidateIndex: 0,
          decision: 'NEW',
          targetMemoryId: null,
          category: 'FOOD',
          subject: '牛肉麵',
          content: '這家很好吃',
          sourceConversationMessageId: 33,
        },
      }),
    );
  });

  it.each(['DUPLICATE', 'UPDATE', 'CONTRADICT'] as const)(
    '%s requires an active target memory id',
    async (decision) => {
      const repository: MemoryCandidateRepository = {
        listActiveMemories: vi.fn(async () => []),
        persistClassifiedCandidate: vi.fn(),
      };
      const pipeline = new MemoryCandidatePipeline(repository);

      await expect(
        pipeline.persist({
          requestId: 5,
          groupId: 2,
          claimAttemptCount: 1,
          actorLineUserId: null,
          candidate: {
            candidateIndex: 0,
            decision,
            targetMemoryId: null,
            category: 'FACT',
            subject: null,
            content: '內容',
            sourceConversationMessageId: 33,
          },
        }),
      ).rejects.toThrow('must target an active memory');
    },
  );

  it('rejects a NEW candidate that points at an existing memory', async () => {
    const repository: MemoryCandidateRepository = {
      listActiveMemories: vi.fn(async () => []),
      persistClassifiedCandidate: vi.fn(),
    };
    const pipeline = new MemoryCandidatePipeline(repository);

    await expect(
      pipeline.persist({
        requestId: 5,
        groupId: 2,
        claimAttemptCount: 1,
        actorLineUserId: null,
        candidate: {
          candidateIndex: 0,
          decision: 'NEW',
          targetMemoryId: 9,
          category: 'FACT',
          subject: null,
          content: '內容',
          sourceConversationMessageId: 33,
        },
      }),
    ).rejects.toThrow('must not target');
  });
});
