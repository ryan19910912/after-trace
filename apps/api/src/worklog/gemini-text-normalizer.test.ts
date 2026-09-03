import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiWorklogTextRequestBody,
  GeminiWorklogTextNormalizer,
  WorklogTextProviderError,
} from './gemini-text-normalizer';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE',
  model: 'gemini-3.5-flash',
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
  it('builds a narrow title/time request without legacy summary/category fields', () => {
    const body = buildGeminiWorklogTextRequestBody(input, 256);
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('record_text');
    expect(serialized).toContain('title_requires_confirmation');
    expect(serialized).toContain('occurred_at');
    expect(serialized).toContain('Asia/Taipei');
    expect(serialized).not.toContain('customer_hint');
    expect(serialized).not.toContain('project_hint');
    expect(serialized).not.toContain('"category"');
    expect(serialized).not.toContain('"summary"');
  });

  it('parses one title and nullable occurred time while preserving provider usage', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      responseId: 'provider-response-1',
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              title: '晴空案',
              title_requires_confirmation: false,
              occurred_at: '2026-09-04T09:00:00+08:00',
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
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(provider.normalize(input, config)).resolves.toEqual({
      output: {
        title: '晴空案',
        titleRequiresConfirmation: false,
        occurredAt: '2026-09-04T01:00:00.000Z',
      },
      inputTokens: 120,
      outputTokens: 30,
      providerResponseId: 'provider-response-1',
      latencyMs: expect.any(Number),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('accepts a null title only when the provider marks it for confirmation', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        title: null,
        title_requires_confirmation: true,
        occurred_at: null,
      }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 }));
    const provider = new GeminiWorklogTextNormalizer({ apiKey: 'test-key', fetchFn: fetchFn as typeof fetch });

    await expect(provider.normalize(input, config)).resolves.toMatchObject({
      output: {
        title: null,
        titleRequiresConfirmation: true,
        occurredAt: null,
      },
    });
  });

  it('rejects the removed legacy summary/category response shape', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        summary: '舊格式',
        category: 'WORK',
        customer_hint: null,
        project_hint: null,
      }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 }));
    const provider = new GeminiWorklogTextNormalizer({ apiKey: 'test-key', fetchFn: fetchFn as typeof fetch });

    await expect(provider.normalize(input, config)).rejects.toMatchObject<Partial<WorklogTextProviderError>>({
      code: 'GEMINI_INVALID_RESPONSE',
    });
  });
});
