import { z } from 'zod';
import {
  normalizeWorklogTextOutput,
  type WorklogAiRuntimeConfigSnapshot,
  type WorklogTextNormalizationProvider,
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
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

const structuredOutputSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  category: z.enum(['NOTE', 'WORK', 'ISSUE', 'PAYMENT', 'EXPENSE', 'MATERIAL', 'OTHER']),
  customer_hint: z.string().trim().min(1).max(255).nullable(),
  project_hint: z.string().trim().min(1).max(255).nullable(),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Concise Traditional Chinese work-record summary preserving only facts present in the input.' },
    category: {
      type: 'string',
      enum: ['NOTE', 'WORK', 'ISSUE', 'PAYMENT', 'EXPENSE', 'MATERIAL', 'OTHER'],
    },
    customer_hint: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Customer/person/business name only when explicitly identifiable from the input.',
    },
    project_hint: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Project/site/job hint only when explicitly identifiable from the input.',
    },
  },
  required: ['summary', 'category', 'customer_hint', 'project_hint'],
} as const;

export function buildGeminiWorklogTextRequestBody(text: string, maxOutputTokens = 384) {
  const normalizedText = requiredText(text, 'text', 20_000);
  const maxTokens = positiveInteger(maxOutputTokens, 'maxOutputTokens');
  return {
    systemInstruction: {
      parts: [{
        text: [
          'You normalize AFTERTRACE work records.',
          'Return only grounded facts from the supplied record. Never infer a customer, project, amount, status, date, or action that is not present.',
          'Write summary in concise Traditional Chinese unless the source itself clearly requires preserving another language.',
          'Choose one broad category. customer_hint/project_hint are null unless the source explicitly identifies them.',
          'Do not create database ids and do not turn suggestions into completed work.',
        ].join(' '),
      }],
    },
    contents: [{
      role: 'user',
      parts: [{ text: `原始工作紀錄：\n${normalizedText}` }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      temperature: 0.1,
      maxOutputTokens: maxTokens,
    },
  };
}

export function worklogTextReservationUnits(text: string, maxOutputTokens = 384): number {
  const requestBytes = new TextEncoder().encode(
    JSON.stringify(buildGeminiWorklogTextRequestBody(text, maxOutputTokens)),
  ).byteLength;
  const total = requestBytes + positiveInteger(maxOutputTokens, 'maxOutputTokens');
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new WorklogTextProviderError('AI_RESERVATION_ESTIMATE_INVALID', 'Worklog AI reservation estimate is invalid');
  }
  // One TEXT AI unit currently represents one provider token-equivalent. UTF-8 request
  // bytes are a deliberately conservative upper bound for Gemini prompt tokens.
  return total;
}

export class GeminiWorklogTextNormalizer implements WorklogTextNormalizationProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiWorklogTextNormalizerOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 384, 'maxOutputTokens');
  }

  reservationUnits(text: string, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    return worklogTextReservationUnits(text, this.maxOutputTokens);
  }

  async normalize(
    text: string,
    config: WorklogAiRuntimeConfigSnapshot,
  ): Promise<WorklogTextProviderResponse> {
    this.assertConfig(config);
    const requestBody = buildGeminiWorklogTextRequestBody(text, this.maxOutputTokens);
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
    const output = normalizeWorklogTextOutput(parsed);

    const inputTokens = safeTokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const outputTokens = safeTokenCount(body.usageMetadata?.candidatesTokenCount, 'output');
    if (inputTokens > requestTokenUpperBound) {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini reported input token usage above conservative request-byte bound');
    }
    if (outputTokens > this.maxOutputTokens) {
      throw new WorklogTextProviderError('GEMINI_INVALID_RESPONSE', 'Gemini reported output token usage above configured maximum');
    }

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
      throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', 'Gemini API key is required for Worklog AI normalization');
    }
    if (!config.model.trim() || config.model.length > 255) {
      throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', 'Worklog Gemini model is invalid');
    }
    nonNegativeFinite(config.inputUsdPerMillion, 'inputUsdPerMillion');
    nonNegativeFinite(config.outputUsdPerMillion, 'outputUsdPerMillion');
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

function requiredText(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `invalid ${label}`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `${label} must be a positive safe integer`);
  return value;
}

function nonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new WorklogTextProviderError('GEMINI_CONFIG_INVALID', `${label} must be a non-negative finite number`);
}
