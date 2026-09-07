import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import type {
  AiTimeRangeSummaryProvider,
  AiTimeRangeSummaryProviderInput,
  AiTimeRangeSummaryProviderResponse,
} from './ai-time-range-summary';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class GeminiTimeRangeSummaryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GeminiTimeRangeSummaryError';
  }
}

export type GeminiTimeRangeSummaryOptions = {
  apiKey: string;
  maxOutputTokens?: number;
  endpoint?: string;
  fetchFn?: typeof fetch;
};

const outputSchema = z.object({ summary: z.string().trim().min(1).max(12_000) }).strict();
const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { summary: { type: 'string' } },
  required: ['summary'],
} as const;

export class GeminiWorklogTimeRangeSummarizer implements AiTimeRangeSummaryProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiTimeRangeSummaryOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 1200, 'maxOutputTokens');
  }

  reservationPoints(input: AiTimeRangeSummaryProviderInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const chars = serializedRecords(input).length;
    const estimatedInputTokens = Math.ceil(chars / 2) + 1500;
    const conservativeCostUsd =
      (estimatedInputTokens / 1_000_000) * config.inputUsdPerMillion
      + (this.maxOutputTokens / 1_000_000) * config.outputUsdPerMillion;
    return Math.max(1, providerCostToAiPoints({
      providerCostUsd: conservativeCostUsd,
      outputUsdPerMillion: config.outputUsdPerMillion,
    }));
  }

  async summarize(
    input: AiTimeRangeSummaryProviderInput,
    config: WorklogAiRuntimeConfigSnapshot,
  ): Promise<AiTimeRangeSummaryProviderResponse> {
    this.assertConfig(config);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(config.model.trim())}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.options.apiKey.trim(),
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: [
            'You summarize only the supplied AFTERTRACE Records for the requested time range.',
            'Do not add facts that are not present in the Records.',
            'Preserve important dates, people, projects, amounts, decisions, progress and unresolved items when present.',
            'If Records conflict, mention the conflict rather than choosing an unsupported version.',
            'Use concise Traditional Chinese. Return only the requested JSON object.',
          ].join(' ') }] },
          contents: [{ role: 'user', parts: [{ text: [
            `時區：${input.timeZone}`,
            `範圍：${input.from} 到 ${input.to}`,
            '以下是唯一可使用的紀錄：',
            serializedRecords(input),
          ].join('\n') }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema,
            thinkingConfig: { thinkingLevel: 'low' },
            maxOutputTokens: this.maxOutputTokens,
          },
        }),
      });
    } catch {
      throw new GeminiTimeRangeSummaryError('GEMINI_NETWORK_ERROR', 'Gemini summary request failed before response');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw providerHttpError(response.status, detail);
    }

    let body: {
      responseId?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    try { body = await response.json(); }
    catch { throw new GeminiTimeRangeSummaryError('GEMINI_INVALID_RESPONSE', 'Gemini summary response is not JSON'); }

    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new GeminiTimeRangeSummaryError('GEMINI_INVALID_RESPONSE', 'Gemini summary output missing');
    let parsed: z.infer<typeof outputSchema>;
    try { parsed = outputSchema.parse(JSON.parse(text)); }
    catch { throw new GeminiTimeRangeSummaryError('GEMINI_INVALID_RESPONSE', 'Gemini summary structured output invalid'); }

    const inputTokens = tokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const candidates = tokenCount(body.usageMetadata?.candidatesTokenCount, 'candidate output');
    const thoughts = optionalTokenCount(body.usageMetadata?.thoughtsTokenCount, 'thinking');
    const outputTokens = safeAdd(candidates, thoughts);
    if (candidates > this.maxOutputTokens) throw new GeminiTimeRangeSummaryError('GEMINI_INVALID_RESPONSE', 'Gemini summary output exceeds configured maximum');

    return {
      summary: parsed.summary,
      inputTokens,
      outputTokens,
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot) {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') throw new GeminiTimeRangeSummaryError('AI_PROVIDER_UNSUPPORTED', 'Unsupported AI provider');
    if (!this.options.apiKey.trim()) throw new GeminiTimeRangeSummaryError('GEMINI_CONFIG_INVALID', 'Gemini API key required');
    if (!config.model.trim()) throw new GeminiTimeRangeSummaryError('GEMINI_CONFIG_INVALID', 'Gemini model required');
    nonNegative(config.inputUsdPerMillion, 'input price');
    positive(config.outputUsdPerMillion, 'output price');
  }
}

function serializedRecords(input: AiTimeRangeSummaryProviderInput): string {
  const lines = input.records.map((record) => JSON.stringify({
    id: record.id,
    inputType: record.inputType,
    title: record.title,
    occurredAt: record.occurredAt,
    createdAt: record.createdAt,
    content: record.rawText.slice(0, 20_000),
  }));
  const text = lines.join('\n');
  if (text.length > 100_000) return text.slice(0, 100_000);
  return text;
}

function providerHttpError(status: number, detail: string) {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return new GeminiTimeRangeSummaryError('GEMINI_AUTH_REJECTED', `Gemini authentication rejected (${status})${suffix}`);
  if (status === 404) return new GeminiTimeRangeSummaryError('GEMINI_MODEL_NOT_FOUND', `Gemini model not found (${status})${suffix}`);
  if (status === 429) return new GeminiTimeRangeSummaryError('GEMINI_RATE_LIMITED', `Gemini rate limited request (${status})${suffix}`);
  if (status >= 500) return new GeminiTimeRangeSummaryError('GEMINI_UPSTREAM_FAILURE', `Gemini upstream failed (${status})${suffix}`);
  return new GeminiTimeRangeSummaryError('GEMINI_REQUEST_REJECTED', `Gemini request rejected (${status})${suffix}`);
}
function tokenCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new GeminiTimeRangeSummaryError('GEMINI_INVALID_RESPONSE', `Gemini ${label} usage missing`);
  return value;
}
function optionalTokenCount(value: unknown, label: string): number {
  return value === undefined || value === null ? 0 : tokenCount(value, label);
}
function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new GeminiTimeRangeSummaryError('GEMINI_INVALID_RESPONSE', 'Gemini output usage overflow');
  return value;
}
function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new GeminiTimeRangeSummaryError('GEMINI_CONFIG_INVALID', `${label} invalid`);
  return value;
}
function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new GeminiTimeRangeSummaryError('GEMINI_CONFIG_INVALID', `${label} invalid`);
}
function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new GeminiTimeRangeSummaryError('GEMINI_CONFIG_INVALID', `${label} invalid`);
}
