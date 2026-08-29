import { describe, expect, it, vi } from 'vitest';
import type { MemoryClassificationInput } from './classification-input';
import { GeminiMemoryClassifier } from './gemini-classifier';
import { MemoryAiExecutionError } from './retry-policy';

const input: MemoryClassificationInput = {
  requestId: 1, groupId: 1, origin: 'EXPLICIT', actorLineUserId: 'U-actor', instruction: '記住',
  currentMessages: [{ id: 7, lineMessageId: 'm7', quotedLineMessageId: null, lineUserId: 'U-secret', messageType: 'text', textContent: '喜歡咖啡', quoteToken: null, lineTimestamp: new Date('2026-08-29T01:00:00Z'), metadata: null }],
  previousContext: null, activeMemories: [],
};

describe('GeminiMemoryClassifier', () => {
  it('uses structured JSON output and validates grounding', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(JSON.stringify(body)).not.toContain('U-secret');
      return new Response(JSON.stringify({
        responseId: 'r-1',
        candidates: [{ content: { parts: [{ text: JSON.stringify({ candidates: [{ candidateIndex: 0, decision: 'NEW', targetMemoryId: null, category: 'PREFERENCE', subject: null, content: '喜歡咖啡', sourceConversationMessageId: 7 }] }) }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const classifier = new GeminiMemoryClassifier({ apiKey: 'test-key', model: 'gemini-2.5-flash-lite', fetchFn: fetchFn as typeof fetch });
    const result = await classifier.classify(input);
    expect(result.providerResponseId).toBe('r-1');
    expect(result.tokenUsage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('marks invalid credentials as a permanent provider failure', async () => {
    const classifier = new GeminiMemoryClassifier({
      apiKey: 'bad-key',
      model: 'gemini-2.5-flash-lite',
      fetchFn: vi.fn(async () => new Response('unauthorized', { status: 401 })) as typeof fetch,
    });

    const error = await classifier.classify(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MemoryAiExecutionError);
    expect(error).toMatchObject({ code: 'GEMINI_AUTH_REJECTED', retryable: false });
  });

  it('marks throttling as retryable for the bounded orchestrator policy', async () => {
    const classifier = new GeminiMemoryClassifier({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash-lite',
      fetchFn: vi.fn(async () => new Response('slow down', { status: 429 })) as typeof fetch,
    });

    const error = await classifier.classify(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MemoryAiExecutionError);
    expect(error).toMatchObject({ code: 'GEMINI_RATE_LIMITED', retryable: true });
  });
});
