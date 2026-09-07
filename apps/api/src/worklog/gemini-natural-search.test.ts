import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiNaturalSearchRequest,
  GeminiNaturalSearchInterpreter,
} from './gemini-natural-search';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE',
  model: 'gemini-3.5-flash-lite',
  inputUsdPerMillion: 0.1,
  outputUsdPerMillion: 0.4,
  audioUsdPerMillion: null,
  imageUsdPerMillion: null,
  usdTwdRate: 30,
};

const input = {
  query: '找昨天晴空案的收款紀錄',
  referenceAt: '2026-09-07T12:00:00.000Z',
  timeZone: 'Asia/Taipei',
};

describe('GeminiNaturalSearchInterpreter', () => {
  it('builds only bounded search terms/time filters and explicitly forbids SQL/answers', () => {
    const body = buildGeminiNaturalSearchRequest(input, 256);
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('search_query');
    expect(serialized).toContain('reference_timestamp');
    expect(serialized).toContain('Asia/Taipei');
    expect(serialized).toContain('Never answer the question');
    expect(serialized).toContain('produce SQL');
    expect(serialized).toContain('maxItems');
    expect(serialized).not.toContain('record_ids');
    expect(serialized).not.toContain('sql_query');
  });

  it('uses configured model and preserves provider usage for later settlement', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      responseId: 'search-response-1',
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        terms: ['晴空案', '收款'],
        from: '2026-09-06T00:00:00+08:00',
        to: '2026-09-07T00:00:00+08:00',
      }) }] } }],
      usageMetadata: {
        promptTokenCount: 80,
        candidatesTokenCount: 15,
        thoughtsTokenCount: 5,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new GeminiNaturalSearchInterpreter({ apiKey: 'test-key', fetchFn });

    await expect(provider.interpret(input, config)).resolves.toEqual({
      interpretation: {
        terms: ['晴空案', '收款'],
        from: '2026-09-06T00:00:00+08:00',
        to: '2026-09-07T00:00:00+08:00',
      },
      inputTokens: 80,
      outputTokens: 20,
      providerResponseId: 'search-response-1',
      latencyMs: expect.any(Number),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('/models/gemini-3.5-flash-lite:generateContent');
  });

  it('rejects provider output that tries to return an answer or SQL instead of the accepted filter shape', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        terms: ['晴空案'],
        from: null,
        to: null,
        answer: '找到了三筆',
        sql: 'SELECT * FROM worklog_records',
      }) }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
    }), { status: 200 }));
    const provider = new GeminiNaturalSearchInterpreter({ apiKey: 'test-key', fetchFn });

    await expect(provider.interpret(input, config)).rejects.toMatchObject({
      code: 'GEMINI_INVALID_RESPONSE',
    });
  });

  it('rejects an empty interpretation instead of broadening to all Records', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ terms: [], from: null, to: null }) }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 },
    }), { status: 200 }));
    const provider = new GeminiNaturalSearchInterpreter({ apiKey: 'test-key', fetchFn });

    await expect(provider.interpret(input, config)).rejects.toMatchObject({
      code: 'GEMINI_INVALID_RESPONSE',
    });
  });
});
