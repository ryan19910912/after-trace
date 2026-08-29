import { describe, expect, it } from 'vitest';
import { parseMemoryClassifierOutput } from './classifier-contract';
import type { MemoryClassificationInput } from './classification-input';

const input: MemoryClassificationInput = {
  requestId: 1,
  groupId: 2,
  origin: 'AUTOMATIC',
  actorLineUserId: null,
  instruction: null,
  currentMessages: [
    {
      id: 11,
      lineMessageId: 'line-11',
      lineUserId: 'user-1',
      messageType: 'text',
      textContent: 'Amy 想去花蓮',
      charCount: 8,
      quoteToken: null,
      quotedLineMessageId: null,
      lineTimestamp: new Date('2026-08-29T00:00:00Z'),
      metadata: null,
    },
    {
      id: 12,
      lineMessageId: 'line-12',
      lineUserId: 'user-2',
      messageType: 'text',
      textContent: '我想去台南',
      charCount: 6,
      quoteToken: null,
      quotedLineMessageId: null,
      lineTimestamp: new Date('2026-08-29T00:00:01Z'),
      metadata: null,
    },
  ],
  previousContext: {
    batchId: 8,
    messages: [
      {
        id: 10,
        lineMessageId: 'line-10',
        lineUserId: 'user-2',
        messageType: 'text',
        textContent: '以前聊過花蓮',
        charCount: 7,
        quoteToken: null,
        quotedLineMessageId: null,
        lineTimestamp: new Date('2026-08-28T00:00:00Z'),
        metadata: null,
      },
    ],
  },
  activeMemories: [
    {
      id: 90,
      category: 'PLACE',
      subject: '花蓮',
      content: 'Amy 不想去花蓮',
      sourceMessageId: 'older',
      sourceLineUserId: 'user-1',
      sourceLineTimestamp: new Date('2026-01-01T00:00:00Z'),
    },
  ],
  eligibleSubjectLineUserIds: ['user-1'],
};

describe('parseMemoryClassifierOutput', () => {
  it('accepts a candidate grounded in an eligible current speaker and active memories', () => {
    expect(
      parseMemoryClassifierOutput(
        {
          candidates: [
            {
              candidateIndex: 0,
              decision: 'CONTRADICT',
              targetMemoryId: 90,
              category: 'PLACE',
              subject: '花蓮',
              content: 'Amy 想去花蓮',
              sourceConversationMessageId: 11,
            },
          ],
        },
        input,
      ),
    ).toHaveLength(1);
  });

  it('rejects a current source authored by an ineligible background speaker', () => {
    expect(() =>
      parseMemoryClassifierOutput(
        {
          candidates: [
            {
              candidateIndex: 0,
              decision: 'NEW',
              targetMemoryId: null,
              category: 'PLACE',
              subject: '台南',
              content: '想去台南',
              sourceConversationMessageId: 12,
            },
          ],
        },
        input,
      ),
    ).toThrow('ineligible automatic-memory subject');
  });

  it('does not let previous context become a new source attribution', () => {
    expect(() =>
      parseMemoryClassifierOutput(
        {
          candidates: [
            {
              candidateIndex: 0,
              decision: 'NEW',
              targetMemoryId: null,
              category: 'PLACE',
              subject: '花蓮',
              content: '以前聊過花蓮',
              sourceConversationMessageId: 10,
            },
          ],
        },
        input,
      ),
    ).toThrow('outside the current request');
  });

  it('rejects hallucinated active-memory ids and unstable candidate indexes', () => {
    expect(() =>
      parseMemoryClassifierOutput(
        {
          candidates: [
            {
              candidateIndex: 0,
              decision: 'UPDATE',
              targetMemoryId: 999,
              category: 'PLACE',
              subject: '花蓮',
              content: 'Amy 想去花蓮',
              sourceConversationMessageId: 11,
            },
          ],
        },
        input,
      ),
    ).toThrow('non-active target memory');

    expect(() =>
      parseMemoryClassifierOutput(
        {
          candidates: [
            {
              candidateIndex: 3,
              decision: 'NEW',
              targetMemoryId: null,
              category: 'PLACE',
              subject: null,
              content: 'Amy 想去花蓮',
              sourceConversationMessageId: 11,
            },
          ],
        },
        input,
      ),
    ).toThrow();
  });
});
