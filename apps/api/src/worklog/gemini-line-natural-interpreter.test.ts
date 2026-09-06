import { describe, expect, it } from 'vitest';
import { GeminiWorklogLineNaturalInterpreter, buildGeminiWorklogLineNaturalInterpreterRequestBody } from './gemini-line-natural-interpreter';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};

function baseOutput(overrides: Record<string, unknown>) {
  return {
    intent: 'UNKNOWN',
    record_content: null,
    record_title: null,
    record_title_requires_confirmation: false,
    record_occurred_at: null,
    record_search_terms: [],
    query_text: null,
    edit_instruction: null,
    edit_raw_text: null,
    edit_occurred_at: null,
    edit_title: null,
    edit_title_requires_confirmation: false,
    move_title: null,
    reason: null,
    ...overrides,
  };
}

function response(output: Record<string, unknown>) {
  return new Response(JSON.stringify({
    responseId: 'response-1',
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('GeminiWorklogLineNaturalInterpreter', () => {
  it('builds one structured request with bounded record/history/mutation intents only', () => {
    const body = buildGeminiWorklogLineNaturalInterpreterRequestBody({
      text: '幫我記一下今天晴空案收了三千清潔費',
      referenceOccurredAt: '2026-09-06T02:00:00.000Z',
      quotedText: null,
      target: null,
    });
    const json = JSON.stringify(body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    for (const intent of ['RECORD', 'QUERY', 'EDIT', 'DELETE', 'RESTORE', 'MOVE', 'UNKNOWN']) expect(json).toContain(intent);
    expect(json).not.toContain('SYSTEM_QUERY');
    expect(json).not.toContain('AI_BALANCE');
    expect(json).toContain('record_search_terms');
    expect(json).toContain('move_title');
  });

  it('returns RECORD title/content/date/search terms from the same provider response', async () => {
    const fetchFn: typeof fetch = async () => response(baseOutput({
      intent: 'RECORD',
      record_content: '今天晴空案收了三千清潔費',
      record_title: '晴空案',
      record_occurred_at: '2026-09-06',
      record_search_terms: ['晴空案', '收款', '清潔費', '3000'],
    }));
    const provider = new GeminiWorklogLineNaturalInterpreter({ apiKey: 'test-key', fetchFn });
    const result = await provider.interpret({ text: '幫我記一下今天晴空案收了三千清潔費', referenceOccurredAt: '2026-09-06T02:00:00.000Z', quotedText: null, target: null }, config);
    expect(result.interpretation).toMatchObject({ intent: 'RECORD', content: '今天晴空案收了三千清潔費', record: { title: '晴空案', occurredAt: '2026-09-05T16:00:00.000Z' } });
    expect(result.outputTokens).toBe(50);
  });

  it('returns MOVE without inventing the backend target', async () => {
    const fetchFn: typeof fetch = async () => response(baseOutput({ intent: 'MOVE', move_title: '晴空案' }));
    const provider = new GeminiWorklogLineNaturalInterpreter({ apiKey: 'test-key', fetchFn });
    await expect(provider.interpret({ text: '把這筆移到晴空案', referenceOccurredAt: '2026-09-06T02:00:00.000Z', target: null }, config)).resolves.toMatchObject({ interpretation: { intent: 'MOVE', title: '晴空案' } });
  });
});
