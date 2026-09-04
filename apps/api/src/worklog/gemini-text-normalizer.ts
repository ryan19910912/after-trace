import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import {
  normalizeWorklogTextOutput,
  type WorklogAiRuntimeConfigSnapshot,
  type WorklogTextNormalizationProvider,
  type WorklogTextProviderInput,
  type WorklogTextProviderResponse,
} from './text-normalization';

export class WorklogTextProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorklogTextProviderError';
  }
}

export type GeminiWorklogTextNormalizerOptions = {
  apiKey: string;
  maxOutputTokens?: number;
  endpoint?: string;
  fetchFn?: typeof fetch;
};

type GeminiGenerateContentResponse = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

const STABLE_WORKLOG_MODEL = 'gemini-3.5-flash';
const THINKING_LEVEL = 'low';
const PRODUCT_TIME_ZONE = 'Asia/Taipei';

const structuredOutputSchema = z.object({
  title: z.string().trim().min(1).max(255).nullable(),
  title_requires_confirmation: z.boolean(),
  occurred_at: z.string().trim().min(1).max(64).nullable(),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Exactly one concise filing title for this Record, or null when the text does not provide enough grounded context to choose one safely.',
    },
    title_requires_confirmation: {
      type: 'boolean',
      description: 'True when more than one plausible filing title exists or choosing/creating the proposed title would require user confirmation.',
    },
    occurred_at: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'RFC3339 event datetime only when the Record text explicitly provides or implies event time; null means keep the original LINE/create timestamp.',
    },
  },
  required: ['title', 'title_requires_confirmation', 'occurred_at'],
} as const;

export function buildGeminiWorklogTextRequestBody(
  input: WorklogTextProviderInput,
  maxOutputTokens = 256,
) {
  const text = requiredText(input.text, 'text', 20_000);
  const referenceOccurredAt = requiredDateTime(input.referenceOccurredAt, 'referenceOccurredAt');
  const maxTokens = positiveInteger(maxOutputTokens, 'maxOutputTokens');
  return {
    systemInstruction: {
      parts: [{
        text: [
          'You interpret one newly persisted AFTERTRACE work Record.',
          'The raw Record text is already durable and must never be summarized, rewritten, or replaced by your output.',
          'Your job is intentionally narrow: propose exactly one filing title and optionally resolve the real event time.',
          'Choose the title that best represents the Record filing context (for example a site, job, customer, equipment, person, or other central subject actually grounded in the text).',
          'Do not create extra related entities for people or objects merely mentioned in the text.',
          'If there is not enough grounded context to choose one title safely, return title=null and title_requires_confirmation=true.',
          'If several titles are plausible, return the best grounded proposal but set title_requires_confirmation=true.',
          'If the text has no explicit or relative event-time expression, occurred_at must be null.',
          `Resolve relative time expressions against the supplied reference timestamp using ${PRODUCT_TIME_ZONE}, and return RFC3339 with an explicit offset or Z.`,
          'Do not output summary, category, customer/project hints, amounts, database ids, or any fields outside the schema.',
        ].join(' '),
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: [
          `reference_timestamp: ${referenceOccurredAt}`,
          `reference_timezone: ${PRODUCT_TIME_ZONE}`,
          'record_text:',
          text,
        ].join('\n'),
      }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      maxOutputTokens: maxTokens,
    },
  };
}

/**
 * Conservative provider-token upper bound used only to size a preflight point hold.
 * Request bytes are intentionally treated as a token upper bound; output receives a
 * second thinking-sized cushion. Actual customer points are always recomputed from
 * provider-reported cost after the request succeeds.
 */
export function worklogTextReservationTokenUpperBound(
  input: WorklogTextProviderInput,
  maxOutputTokens = 256,
): number {
  const requestBytes = new TextEncoder().encode(
    JSON.stringify(buildGeminiWorklogTextRequestBody(input, maxOutputTokens)),
  ).byteLength;
  const outputBudget = positiveInteger(maxOutputTokens, 'maxOutputTokens');
  const total = requestBytes + outputBudget + outputBudget;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new WorklogTextProviderError('AI_RESERVATION_ESTIMATE_INVALID', 'Worklog AI reservation estimate is invalid');
  }
  return total;
}

export class GeminiWorklogTextNormalizer implements WorklogTextNormalizationProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiWorklogTextNormalizerOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 256, 'maxOutputTokens');
  }

  reservationPoints(input: WorklogTextProviderInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const upperBound = worklogTextReservationTokenUpperBound(input, this.maxOutputTokens);
    // Price every conservative upper-bound unit at the more expensive of input/output
    // pricing. This is deliberately a hold estimate, not customer billing.
    const conservativeCostUsd =
      (upperBound / 1_000_000) * Math.max(config.inputUsdPerMillion, config.outputUsdPerMillion);
    return Math.max(1, providerCostToAiPoints({
      providerCostUsd: conservativeCostUsd,
      outputUsdPerMillion: config.outputUsdPerMillion,
    }));
  }

  async normalize(
    input: WorklogTextProviderInput,
    config: WorklogAiRuntimeConfigSnapshot,
  ): Promise<WorklogTextProviderResponse> {
    this.assertConfig(config);
    const requestBody = buildGeminiWorklogTextRequestBody(input, this.maxOutputTokens);
    const requestTokenUpperBound = new TextEncoder().encode(JSON.stringify(requestBody)).byteLength;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.endpoint}/models/${encodeURIComponent(config.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.options.apiKey.trim(),
          },
          body: JSON.stringify(requestBody),
        },
      );
    } catch {
      throw new WorklogTextProviderError('GEMINI_NETWORK_ERROR', 'Gemini worklog request failed before a response was received');
    }

    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw providerHttpError(response.status, detail);
    }

    let body: GeminiGenerateContentResponse;
    try {
      body = (await response.json()) as GeminiGenerateContentResponse;
    } catch {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini worklog response body was not valid JSON');
    }

    const outputText = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!outputText) {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini worklog response did not contain structured output');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(outputText);
    } catch {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini worklog structured output was not valid JSON');
    }

    let parsed: z.infer<typeof structuredOutputSchema>;
    try {
      parsed = structuredOutputSchema.parse(raw);
    } catch {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini worklog structured output failed schema validation');
    }

    let output;
    try {
      output = normalizeWorklogTextOutput(parsed);
    } catch (error) {
      throw new WorklogTextProviderError(
        'GEMINI_INVALID_RESPONSE',
        error instanceof Error ? error.message : 'Gemini worklog interpretation was invalid',
      );
    }

    const inputTokens = safeTokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const candidateTokens = safeTokenCount(body.usageMetadata?.candidatesTokenCount, 'candidate output');
    const thoughtsTokens = optionalTokenCount(body.usageMetadata?.thoughtsTokenCount, 'thinking');
    if (inputTokens > requestTokenUpperBound) {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini reported input token usage above conservative request-byte bound');
    }
    if (candidateTokens > this.maxOutputTokens) {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini reported candidate output usage above configured maximum');
    }
    const outputTokens = safeAddTokens(candidateTokens, thoughtsTokens, 'billed output');

    return {
      output,
      inputTokens,
      outputTokens,
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs,
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot): void {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') {
      throw new WorklogTextProviderError('AI_PROVIDER_UNSUPPORTED', `Unsupported worklog AI provider: ${config.provider}`);
    }
    if (!this.options.apiKey.trim()) {
      throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', 'Gemini API key is required for Worklog AI interpretation');
    }
    if (config.model.trim() !== STABLE_WORKLOG_MODEL) {
      throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `Worklog currently supports only ${STABLE_WORKLOG_MODEL}`);
    }
    nonNegativeFinite(config.inputUsdPerMillion, 'inputUsdPerMillion');
    positiveFinite(config.outputUsdPerMillion, 'outputUsdPerMillion');
    if (config.usdTwdRate !== null) nonNegativeFinite(config.usdTwdRate, 'usdTwdRate');
  }
}

function providerHttpError(status: number, detail: string): WorklogTextProviderError {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return new WorklogTextProviderError('GEMINI_AUTH_REJECTED', `Gemini authentication rejected (${status})${suffix}`);
  if (status === 400) return new WorklogTextProviderError('GEMINI_BAD_REQUEST', `Gemini request was rejected (${status})${suffix}`);
  if (status === 404) return new WorklogTextProviderError('GEMINI_MODEL_NOT_FOUND', `Gemini model was not found (${status})${suffix}`);
  if (status === 408) return new WorklogTextProviderError('GEMINI_TIMEOUT', `Gemini request timed out (${status})${suffix}`);
  if (status === 429) return new WorklogTextProviderError('GEMINI_RATE_LIMITED', `Gemini rate limited the request (${status})${suffix}`);
  if (status >= 500) return new WorklogTextProviderError('GEMINI_UPSTREAM_FAILURE', `Gemini upstream failed (${status})${suffix}`);
  return new WorklogTextProviderError('GEMINI_REQUEST_REJECTED', `Gemini request failed (${status})${suffix}`);
}

function safeTokenCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', `Gemini response is missing valid ${label} token usage`);
  }
  return value;
}

function optionalTokenCount(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0;
  return safeTokenCount(value, label);
}

function safeAddTokens(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} token usage overflow`);
  }
  return total;
}

function requiredText(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `invalid ${label}`);
  }
  return normalized;
}

function requiredDateTime(value: string, label: string): string {
  const normalized = requiredText(value, label, 64);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `invalid ${label}`);
  }
  return parsed.toISOString();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `${label} must be a non-negative finite number`);
  }
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `${label} must be a positive finite number`);
  }
}