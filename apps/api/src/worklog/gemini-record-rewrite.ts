import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import type { AiRewriteProvider, AiRewriteProviderInput, AiRewriteProviderResponse } from './ai-record-rewrite';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class GeminiRecordRewriteError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'GeminiRecordRewriteError'; }
}

const outputSchema = z.object({ proposed_text: z.string().trim().min(1).max(20_000) }).strict();
const responseJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: { proposed_text: { type: 'string' } }, required: ['proposed_text'],
} as const;

export class GeminiWorklogRecordRewriter implements AiRewriteProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: { apiKey: string; maxOutputTokens?: number; endpoint?: string; fetchFn?: typeof fetch }) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 1400);
  }

  reservationPoints(input: AiRewriteProviderInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const estimatedInputTokens = Math.ceil((input.record.rawText.length + input.instruction.length) / 2) + 1000;
    const cost = (estimatedInputTokens / 1_000_000) * config.inputUsdPerMillion
      + (this.maxOutputTokens / 1_000_000) * config.outputUsdPerMillion;
    return Math.max(1, providerCostToAiPoints({ providerCostUsd: cost, outputUsdPerMillion: config.outputUsdPerMillion }));
  }

  async rewrite(input: AiRewriteProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<AiRewriteProviderResponse> {
    this.assertConfig(config);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(config.model.trim())}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: [
            'You rewrite one AFTERTRACE Record according to the explicit user instruction.',
            'Preserve facts. Do not invent people, dates, amounts, completion states or events.',
            'Return the complete proposed replacement Record text, not commentary.',
            'Use Traditional Chinese unless the source wording should be preserved.',
          ].join(' ') }] },
          contents: [{ role: 'user', parts: [{ text: `使用者指示：${input.instruction}\n\n原始紀錄：\n${input.record.rawText}` }] }],
          generationConfig: {
            responseMimeType: 'application/json', responseJsonSchema,
            thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: this.maxOutputTokens,
          },
        }),
      });
    } catch { throw new GeminiRecordRewriteError('GEMINI_NETWORK_ERROR', 'Gemini rewrite request failed before response'); }
    if (!response.ok) throw providerHttpError(response.status, (await response.text()).slice(0, 500));

    let body: { responseId?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    try { body = await response.json(); }
    catch { throw new GeminiRecordRewriteError('GEMINI_INVALID_RESPONSE', 'Gemini rewrite response is not JSON'); }
    const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!raw) throw new GeminiRecordRewriteError('GEMINI_INVALID_RESPONSE', 'Gemini rewrite output missing');
    let parsed: z.infer<typeof outputSchema>;
    try { parsed = outputSchema.parse(JSON.parse(raw)); }
    catch { throw new GeminiRecordRewriteError('GEMINI_INVALID_RESPONSE', 'Gemini rewrite structured output invalid'); }
    const inputTokens = token(body.usageMetadata?.promptTokenCount);
    const candidateTokens = token(body.usageMetadata?.candidatesTokenCount);
    const thoughtsTokens = body.usageMetadata?.thoughtsTokenCount == null ? 0 : token(body.usageMetadata.thoughtsTokenCount);
    const outputTokens = candidateTokens + thoughtsTokens;
    if (!Number.isSafeInteger(outputTokens) || candidateTokens > this.maxOutputTokens) throw new GeminiRecordRewriteError('GEMINI_INVALID_RESPONSE', 'Gemini rewrite usage invalid');
    return { proposedText: parsed.proposed_text, inputTokens, outputTokens, providerResponseId: body.responseId?.slice(0, 255) ?? null, latencyMs: Math.max(0, Date.now() - startedAt) };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot) {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') throw new GeminiRecordRewriteError('AI_PROVIDER_UNSUPPORTED', 'Unsupported provider');
    if (!this.options.apiKey.trim() || !config.model.trim()) throw new GeminiRecordRewriteError('GEMINI_CONFIG_INVALID', 'Gemini config incomplete');
    if (!Number.isFinite(config.inputUsdPerMillion) || config.inputUsdPerMillion < 0 || !Number.isFinite(config.outputUsdPerMillion) || config.outputUsdPerMillion <= 0) throw new GeminiRecordRewriteError('GEMINI_CONFIG_INVALID', 'Gemini pricing invalid');
  }
}

function providerHttpError(status: number, detail: string) {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return new GeminiRecordRewriteError('GEMINI_AUTH_REJECTED', `Gemini authentication rejected (${status})${suffix}`);
  if (status === 404) return new GeminiRecordRewriteError('GEMINI_MODEL_NOT_FOUND', `Gemini model not found (${status})${suffix}`);
  if (status === 429) return new GeminiRecordRewriteError('GEMINI_RATE_LIMITED', `Gemini rate limited (${status})${suffix}`);
  if (status >= 500) return new GeminiRecordRewriteError('GEMINI_UPSTREAM_FAILURE', `Gemini upstream failed (${status})${suffix}`);
  return new GeminiRecordRewriteError('GEMINI_REQUEST_REJECTED', `Gemini request rejected (${status})${suffix}`);
}
function token(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new GeminiRecordRewriteError('GEMINI_INVALID_RESPONSE', 'Gemini usage missing'); return value; }
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new GeminiRecordRewriteError('GEMINI_CONFIG_INVALID', 'maxOutputTokens invalid'); return value; }
