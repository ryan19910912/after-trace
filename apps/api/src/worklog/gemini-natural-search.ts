import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import type {
  AiNaturalSearchProvider,
  AiNaturalSearchProviderInput,
  AiNaturalSearchProviderResponse,
} from './ai-natural-search';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class AiNaturalSearchProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiNaturalSearchProviderError';
  }
}

export type GeminiNaturalSearchOptions = {
  apiKey: string;
  maxOutputTokens?: number;
  endpoint?: string;
  fetchFn?: typeof fetch;
};

const THINKING_LEVEL = 'low';

const outputSchema = z.object({
  terms: z.array(z.string().trim().min(1).max(100)).max(8),
  from: z.string().trim().min(1).max(64).nullable(),
  to: z.string().trim().min(1).max(64).nullable(),
}).strict().superRefine((value, context) => {
  if (value.terms.length === 0 && value.from === null && value.to === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'empty search interpretation' });
  }
});

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    terms: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
      description: 'Short grounded search terms/synonyms only. Do not invent facts.',
    },
    from: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Inclusive ISO-8601 timestamp lower bound only when the query expresses a time constraint.',
    },
    to: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Exclusive ISO-8601 timestamp upper bound only when the query expresses a time constraint.',
    },
  },
  required: ['terms', 'from', 'to'],
} as const;

type GeminiResponse = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

export class GeminiNaturalSearchInterpreter implements AiNaturalSearchProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiNaturalSearchOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 256, 'maxOutputTokens');
  }

  reservationPoints(input: AiNaturalSearchProviderInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const requestBytes = new TextEncoder().encode(JSON.stringify(buildGeminiNaturalSearchRequest(input, this.maxOutputTokens))).byteLength;
    const upperBoundUnits = requestBytes + this.maxOutputTokens + this.maxOutputTokens;
    if (!Number.isSafeInteger(upperBoundUnits) || upperBoundUnits <= 0) {
      throw new AiNaturalSearchProviderError('AI_RESERVATION_ESTIMATE_INVALID', 'search reservation estimate invalid');
    }
    const conservativeCostUsd = (upperBoundUnits / 1_000_000)
      * Math.max(config.inputUsdPerMillion, config.outputUsdPerMillion);
    return Math.max(1, providerCostToAiPoints({
      providerCostUsd: conservativeCostUsd,
      outputUsdPerMillion: config.outputUsdPerMillion,
    }));
  }

  async interpret(
    input: AiNaturalSearchProviderInput,
    config: WorklogAiRuntimeConfigSnapshot,
  ): Promise<AiNaturalSearchProviderResponse> {
    this.assertConfig(config);
    const request = buildGeminiNaturalSearchRequest(input, this.maxOutputTokens);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(config.model.trim())}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.options.apiKey.trim(),
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new AiNaturalSearchProviderError('GEMINI_NETWORK_ERROR', 'Gemini search request failed before response');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw providerHttpError(response.status, detail);
    }

    let body: GeminiResponse;
    try { body = await response.json() as GeminiResponse; }
    catch { throw new AiNaturalSearchProviderError('GEMINI_INVALID_RESPONSE', 'Gemini search response is not JSON'); }

    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new AiNaturalSearchProviderError('GEMINI_INVALID_RESPONSE', 'Gemini search output missing');
    let parsed: z.infer<typeof outputSchema>;
    try { parsed = outputSchema.parse(JSON.parse(text)); }
    catch { throw new AiNaturalSearchProviderError('GEMINI_INVALID_RESPONSE', 'Gemini search structured output invalid'); }

    const inputTokens = tokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const candidateTokens = tokenCount(body.usageMetadata?.candidatesTokenCount, 'candidate output');
    const thoughtsTokens = optionalTokenCount(body.usageMetadata?.thoughtsTokenCount, 'thinking');
    if (candidateTokens > this.maxOutputTokens) {
      throw new AiNaturalSearchProviderError('GEMINI_INVALID_RESPONSE', 'Gemini search candidate output exceeds configured maximum');
    }
    const outputTokens = safeAdd(candidateTokens, thoughtsTokens);

    return {
      interpretation: {
        terms: parsed.terms,
        from: parsed.from,
        to: parsed.to,
      },
      inputTokens,
      outputTokens,
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot) {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') {
      throw new AiNaturalSearchProviderError('AI_PROVIDER_UNSUPPORTED', `Unsupported provider: ${config.provider}`);
    }
    if (!this.options.apiKey.trim()) throw new AiNaturalSearchProviderError('GEMINI_CONFIG_INVALID', 'Gemini API key required');
    if (!config.model.trim() || config.model.trim().length > 255) {
      throw new AiNaturalSearchProviderError('GEMINI_CONFIG_INVALID', 'Gemini model required');
    }
    finite(config.inputUsdPerMillion, false, 'inputUsdPerMillion');
    finite(config.outputUsdPerMillion, true, 'outputUsdPerMillion');
    if (config.usdTwdRate !== null) finite(config.usdTwdRate, false, 'usdTwdRate');
  }
}

export function buildGeminiNaturalSearchRequest(
  input: AiNaturalSearchProviderInput,
  maxOutputTokens = 256,
) {
  const query = requiredText(input.query, 1000, 'query');
  const referenceAt = requiredDate(input.referenceAt);
  const timeZone = requiredText(input.timeZone, 64, 'timeZone');
  return {
    systemInstruction: { parts: [{ text: [
      'You translate one AFTERTRACE natural-language search request into bounded deterministic PostgreSQL retrieval filters.',
      'Never answer the question, summarize Records, produce SQL, database ids, or invent stored facts.',
      'Return at most 8 short grounded search terms/synonyms and optional time bounds.',
      'Only create a time bound when the user explicitly expresses a date/time/range or a relative time phrase.',
      'Resolve relative time phrases against the supplied reference timestamp and timezone.',
      'from is inclusive and to is exclusive; use ISO-8601 timestamps with an explicit offset or Z.',
      'If the user asks only for a date/time range, terms may be empty.',
      'If the user asks only for a topic/person/project/action, from and to must be null.',
      'Keep synonyms narrow and grounded to retrieval intent. Do not infer payment/completion/status facts that the query did not express.',
    ].join(' ') }] },
    contents: [{ role: 'user', parts: [{ text: [
      `reference_timestamp: ${referenceAt}`,
      `reference_timezone: ${timeZone}`,
      'search_query:',
      query,
    ].join('\n') }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      maxOutputTokens: positiveInteger(maxOutputTokens, 'maxOutputTokens'),
    },
  };
}

function providerHttpError(status: number, detail: string) {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return new AiNaturalSearchProviderError('GEMINI_AUTH_REJECTED', `Gemini authentication rejected (${status})${suffix}`);
  if (status === 404) return new AiNaturalSearchProviderError('GEMINI_MODEL_NOT_FOUND', `Gemini model not found (${status})${suffix}`);
  if (status === 429) return new AiNaturalSearchProviderError('GEMINI_RATE_LIMITED', `Gemini rate limited request (${status})${suffix}`);
  if (status >= 500) return new AiNaturalSearchProviderError('GEMINI_UPSTREAM_FAILURE', `Gemini upstream failed (${status})${suffix}`);
  return new AiNaturalSearchProviderError('GEMINI_REQUEST_REJECTED', `Gemini request rejected (${status})${suffix}`);
}
function tokenCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AiNaturalSearchProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} usage missing`);
  }
  return value;
}
function optionalTokenCount(value: unknown, label: string): number {
  return value === undefined || value === null ? 0 : tokenCount(value, label);
}
function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new AiNaturalSearchProviderError('GEMINI_INVALID_RESPONSE', 'Gemini billed output usage overflow');
  }
  return total;
}
function requiredDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AiNaturalSearchProviderError('GEMINI_CONFIG_INVALID', 'referenceAt invalid');
  return parsed.toISOString();
}
function requiredText(value: string, max: number, label: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > max) {
    throw new AiNaturalSearchProviderError('GEMINI_CONFIG_INVALID', `${label} invalid`);
  }
  return normalized;
}
function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AiNaturalSearchProviderError('GEMINI_CONFIG_INVALID', `${label} invalid`);
  }
  return value;
}
function finite(value: number, positive: boolean, label: string) {
  if (!Number.isFinite(value) || value < 0 || (positive && value <= 0)) {
    throw new AiNaturalSearchProviderError('GEMINI_CONFIG_INVALID', `${label} invalid`);
  }
}