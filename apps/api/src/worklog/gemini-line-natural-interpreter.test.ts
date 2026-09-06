import { describe, expect, it } from 'vitest';
import { GeminiWorklogLineNaturalInterpreter, buildGeminiWorklogLineNaturalInterpreterRequestBody } from './gemini-line-natural-interpreter';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};

describe('GeminiWorklogLineNaturalInterpreter', () => {
  it('builds one structured request that asks for intent and intent-specific fields together', () => {
    const body = buildGeminiWorklogLineNaturalInterpreterRequestBody({
      text: '幫我記一下今天晴空案收了三千清潔費',
      referenceOccurredAt: '2026-09-06T02:00:00.000Z',
      quotedText: null,
      target: null,
    });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(JSON.stringify(body)).toContain('RECORD');
    expect(JSON.stringify(body)).toContain('QUERY');
    expect(JSON.stringify(body)).toContain('EDIT');
    expect(JSON.stringify(body)).toContain('record_search_terms');
  });

  it('returns RECORD title/content/date/search terms from the same provider response', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({
      responseId: 'response-1',
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        intent: 'RECORD',
        record_content: '今天晴空案收了三千清潔費',
        record_title: '晴空案',
        record_title_requires_confirmation: false,
        record_occurred_at: '2026-09-06',
        record_search_terms: ['晴空案', '收款', '清潔費', '3000'],
        query_text: null,
        edit_instruction: null,
        edit_raw_text: null,
        edit_occurred_at: null,
        edit_title: null,
        edit_title_requires_confirmation: false,
        reason: null,
      }) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const provider = new GeminiWorklogLineNaturalInterpreter({ apiKey: 'test-key', fetchFn });
    const result = await provider.interpret({
      text: '幫我記一下今天晴空案收了三千清潔費',
      referenceOccurredAt: '2026-09-06T02:00:00.000Z',
      quotedText: null,
      target: null,
    }, config);
    expect(result.interpretation).toMatchObject({
      intent: 'RECORD',
      content: '今天晴空案收了三千清潔費',
      record: { title: '晴空案', occurredAt: '2026-09-05T16:00:00.000Z' },
    });
    expect(result.outputTokens).toBe(50);
  });
});
