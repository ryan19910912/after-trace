import { expect, it } from 'vitest';
import type { MemoryClassificationInput } from './classification-input';
import { buildMemoryClassifierPrompt } from './classifier-prompt';

it('marks previous context as context-only, exposes eligible aliases, and pseudonymizes speakers', () => {
  const input: MemoryClassificationInput = {
    requestId: 1,
    groupId: 2,
    origin: 'AUTOMATIC',
    actorLineUserId: null,
    instruction: null,
    currentMessages: [
      {
        id: 11,
        lineMessageId: 'current',
        lineUserId: 'u1',
        messageType: 'text',
        textContent: 'current',
        charCount: 7,
        quoteToken: null,
        quotedLineMessageId: null,
        lineTimestamp: new Date('2026-08-29T00:00:00Z'),
        metadata: null,
      },
    ],
    previousContext: {
      batchId: 8,
      messages: [
        {
          id: 10,
          lineMessageId: 'previous',
          lineUserId: 'u2',
          messageType: 'text',
          textContent: 'previous',
          charCount: 8,
          quoteToken: null,
          quotedLineMessageId: null,
          lineTimestamp: new Date('2026-08-28T00:00:00Z'),
          metadata: null,
        },
      ],
    },
    activeMemories: [],
    eligibleSubjectLineUserIds: ['u1'],
  };

  const prompt = buildMemoryClassifierPrompt(input);
  const body = JSON.parse(prompt.userPrompt) as {
    request: {
      allowedSourceConversationMessageIds: number[];
      eligibleSubjectSpeakers: string[];
    };
    currentMessages: Array<{ speaker: string | null }>;
    previousContext: { messages: Array<{ id: number; speaker: string | null }> };
  };

  expect(prompt.systemInstruction).toContain('previousContext is context only');
  expect(prompt.systemInstruction).toContain('eligibleSubjectSpeakers');
  expect(body.request.allowedSourceConversationMessageIds).toEqual([11]);
  expect(body.request.eligibleSubjectSpeakers).toEqual(['speaker-1']);
  expect(body.currentMessages[0]?.speaker).toBe('speaker-1');
  expect(body.previousContext.messages[0]?.id).toBe(10);
  expect(body.previousContext.messages[0]?.speaker).toBe('speaker-2');
  expect(prompt.userPrompt).not.toContain('"u1"');
  expect(prompt.userPrompt).not.toContain('"u2"');
});
