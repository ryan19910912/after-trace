import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiWorklogTextRequestBody,
  GeminiWorklogTextNormalizer,
} from './gemini-text-normalizer';
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
  text: '王大明今天去晴空案換冷氣',
  referenceOccurredAt: '2026-09-04T01:00:00.000Z',
};

describe('GeminiWorklogTextNormalizer', () => {
  it('builds a narrow title/date/search request without legacy summary/category fields', () => {
    const body = buildGeminiWorklogTextRequestBody(input, 256);
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('record_text');
    expect(serialized).toContain('title_requires_confirmation');
    expect(serialized).toContain('occurred_at');
    expect(serialized).toContain('search_terms');
    expect(serialized).toContain('Asia/Taipei');
    expect(serialized).not.toContain('customer_hint');
    expect(serialized).not.toContain('project_hint');
    expect(serialized).not.toContain('"category"');
    expect(serialized).not.toContain('"summary"');
  });

  it('uses the configured model and preserves provider usage', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      responseId: 'provider-response-1',
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              title: '晴空案',
              title_requires_confirmation: false,
              occurred_at: '2026-09-04',
              search_terms: ['冷氣', '維修'],
            }),
          }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 10,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new GeminiWorklogTextNormalizer({
      apiKey: 'test-key',
      fetchFn,
    });

    await expect(provider.normalize(input, config)).resolves.toEqual({
      output: {
        title: '晴空案',
        titleRequiresConfirmation: false,
        occurredAt: '2026-09-03T16:00:00.000Z',
        searchTerms: ['冷氣', '維修'],
      },
      inputTokens: 120,
      outputTokens: 30,
      providerResponseId: 'provider-response-1',
      latencyMs: expect.any(Number),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const firstCall = fetchFn.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(String(firstCall![0])).toContain('/models/gemini-3.5-flash-lite:generateContent');
  });

  it('accepts a null title when the provider explicitly marks it for confirmation', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        title: null,
        title_requires_confirmation: true,
        occurred_at: null,
        search_terms: [],
      }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 }));
    const provider = new GeminiWorklogTextNormalizer({ apiKey: 'test-key', fetchFn });

    await expect(provider.normalize(input, config)).resolves.toMatchObject({
      output: {
        title: null,
        titleRequiresConfirmation: true,
        occurredAt: null,
        searchTerms: [],
      },
    });
  });

  it('rejects the removed legacy summary/category response shape', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        summary: '舊格式',
        category: 'WORK',
        customer_hint: null,
        project_hint: null,
      }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 }));
    const provider = new GeminiWorklogTextNormalizer({ apiKey: 'test-key', fetchFn });

    await expect(provider.normalize(input, config)).rejects.toMatchObject({
      code: 'GEMINI_INVALID_RESPONSE',
    });
  });
});
