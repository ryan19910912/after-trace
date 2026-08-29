import { describe, expect, it, vi } from 'vitest';
import { ExtractionBatchInputService, type ExtractionInputRepository } from '../extraction/input';
import { MemoryCandidatePipeline, type MemoryCandidateRepository } from './pipeline';
import {
  MemoryClassificationInputService,
  type MemorySourceMessageRepository,
} from './classification-input';
import type { ClaimedMemoryRequest } from './work';

const sourceMessage = {
  id: 11,
  lineMessageId: 'line-11',
  lineUserId: 'user-1',
  messageType: 'text',
  textContent: '我們下週想去花蓮',
  charCount: 8,
  quoteToken: null,
  quotedLineMessageId: null,
  lineTimestamp: new Date('2026-08-29T00:00:00Z'),
  metadata: null,
};

function claim(overrides: Partial<ClaimedMemoryRequest>): ClaimedMemoryRequest {
  return {
    id: 7,
    groupId: 3,
    origin: 'EXPLICIT',
    extractionBatchId: null,
    actorLineUserId: 'user-1',
    sourceConversationMessageId: 11,
    instruction: '記住我們想去花蓮',
    attemptCount: 1,
    leaseExpiresAt: new Date('2026-08-29T00:02:00Z'),
    ...overrides,
  };
}

function createService(
  extraction: ExtractionInputRepository,
  sources: MemorySourceMessageRepository,
) {
  const candidateRepository: MemoryCandidateRepository = {
    listActiveMemories: vi.fn(async () => [
      {
        id: 90,
        category: 'PLACE',
        subject: '花蓮',
        content: '大家以前去過花蓮',
        sourceMessageId: 'old',
        sourceLineUserId: 'user-2',
        sourceLineTimestamp: new Date('2026-01-01T00:00:00Z'),
      },
    ]),
    persistClassifiedCandidate: vi.fn(),
  };
  return new MemoryClassificationInputService(
    new ExtractionBatchInputService(extraction),
    sources,
    new MemoryCandidatePipeline(candidateRepository),
  );
}

describe('MemoryClassificationInputService', () => {
  it('loads only the resolved source for an explicit request plus group active memories', async () => {
    const input = await createService(
      { loadBatchInput: vi.fn() },
      { loadById: vi.fn(async () => sourceMessage) },
    ).load(claim({}));

    expect(input.origin).toBe('EXPLICIT');
    expect(input.currentMessages).toEqual([sourceMessage]);
    expect(input.previousContext).toBeNull();
    expect(input.activeMemories.map((memory) => memory.id)).toEqual([90]);
  });

  it('loads current + previous extraction context for an automatic request', async () => {
    const previous = { ...sourceMessage, id: 10, lineMessageId: 'line-10' };
    const input = await createService(
      {
        loadBatchInput: vi.fn(async () => ({
          batchId: 44,
          groupId: 3,
          currentMessages: [sourceMessage],
          previousContext: { batchId: 43, messages: [previous] },
        })),
      },
      { loadById: vi.fn() },
    ).load(
      claim({
        origin: 'AUTOMATIC',
        extractionBatchId: 44,
        sourceConversationMessageId: null,
        actorLineUserId: null,
        instruction: null,
      }),
    );

    expect(input.origin).toBe('AUTOMATIC');
    expect(input.currentMessages).toEqual([sourceMessage]);
    expect(input.previousContext?.messages).toEqual([previous]);
  });

  it('rejects an extraction batch from another group', async () => {
    await expect(
      createService(
        {
          loadBatchInput: vi.fn(async () => ({
            batchId: 44,
            groupId: 999,
            currentMessages: [],
            previousContext: null,
          })),
        },
        { loadById: vi.fn() },
      ).load(
        claim({
          origin: 'AUTOMATIC',
          extractionBatchId: 44,
          sourceConversationMessageId: null,
        }),
      ),
    ).rejects.toThrow('belongs to another group');
  });
});
