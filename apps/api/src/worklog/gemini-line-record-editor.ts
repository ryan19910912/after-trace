import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import {
  normalizeWorklogLineRecordEditOutput,
  type WorklogLineRecordEditProvider,
  type WorklogLineRecordEditProviderInput,
  type WorklogLineRecordEditProviderResponse,
} from './line-record-edit';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class WorklogLineEditProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WorklogLineEditProviderError';
  }
}

export type GeminiWorklogLineRecordEditorOptions = {
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

const THINKING_LEVEL = 'low';
const PRODUCT_TIME_ZONE = 'Asia/Taipei';

const structuredOutputSchema = z.object({
  raw_text: z.string().trim().min(1).max(20_000),
  occurred_at: z.string().trim().min(1).max(64).nullable(),
  title: z.string().trim().min(1).max(255).nullable(),
  title_requires_confirmation: z.boolean(),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    raw_text: {
      type: 'string',
      description: 'The complete next durable Record text after applying only the requested edit. Preserve all unrequested facts and wording as much as possible.',
    },
    occurred_at: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'RFC3339 replacement event datetime only if the edit instruction asks to change/correct event time. Null means keep current occurred_at.',
    },
    title: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Exactly one replacement filing title only if the instruction asks to change/correct the title or clearly changes the central filing subject. Null means keep current title.',
    },
    title_requires_confirmation: {
      type: 'boolean',
      description: 'True if the requested title change has multiple plausible targets, could refer to an existing alias/title ambiguously, or otherwise needs user confirmation.',
    },
  },
  required: ['raw_text', 'occurred_at', 'title', 'title_requires_confirmation'],
} as const;

export function buildGeminiWorklogLineEditRequestBody(
  input: WorklogLineRecordEditProviderInput,
  maxOutputTokens = 768,
) {
  const instruction = requiredText(input.instruction, 'instruction', 4_000);
  const currentRawText = requiredText(input.currentRawText, 'currentRawText', 20_000);
  const currentOccurredAt = requiredDateTime(input.currentOccurredAt, 'currentOccurredAt');
  const commandTimestamp = requiredDateTime(input.commandTimestamp, 'commandTimestamp');
  const currentTitle = optionalText(input.currentTitle, 'currentTitle', 255);
  const maxTokens = positiveInteger(maxOutputTokens, 'maxOutputTokens');

  return {
    systemInstruction: {
      parts: [{
        text: [
          'You edit exactly one existing AFTERTRACE work Record selected by a reliable LINE Reply target.',
          'Apply only the user instruction to the supplied current Record. Never create another Record and never delete this Record.',
          'Return raw_text as the complete replacement durable text, preserving every unrequested fact and avoiding summaries.',
          'Only return occurred_at when the instruction actually changes/corrects event time; otherwise return null.',
          'Only return title when the instruction changes/corrects the single filing title or clearly changes the central filing subject; otherwise return null.',
          'There is exactly one filing title. Never return related entities, categories, customer/project fields, finance fields, summaries, database ids, or extra properties.',
          'If a requested title change is ambiguous, return the best grounded proposal but set title_requires_confirmation=true.',
          `Resolve relative time in the edit instruction against command_timestamp using ${PRODUCT_TIME_ZONE}.`,
          'Do not invent facts that are not present in the current Record or edit instruction.',
        ].join(' '),
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: [
          `command_timestamp: ${commandTimestamp}`,
          `reference_timezone: ${PRODUCT_TIME_ZONE}`,
          `current_occurred_at: ${currentOccurredAt}`,
          `current_title: ${currentTitle ?? '(none)'}`,
          'current_record_text:',
          currentRawText,
          'edit_instruction:',
          instruction,
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

export function worklogLineEditReservationTokenUpperBound(
  input: WorklogLineRecordEditProviderInput,
  maxOutputTokens = 768,
): number {
  const requestBytes = new TextEncoder().encode(
    JSON.stringify(buildGeminiWorklogLineEditRequestBody(input, maxOutputTokens)),
  ).byteLength;
  const outputBudget = positiveInteger(maxOutputTokens, 'maxOutputTokens');
  const total = requestBytes + outputBudget + outputBudget;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new WorklogLineEditProviderError('AI_RESERVATION_ESTIMATE_INVALID', 'Worklog LINE edit reservation estimate is invalid');
  }
  return total;
}

export class GeminiWorklogLineRecordEditor implements WorklogLineRecordEditProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiWorklogLineRecordEditorOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 768, 'maxOutputTokens');
  }

  reservationPoints(input: WorklogLineRecordEditProviderInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const upperBound = worklogLineEditReservationTokenUpperBound(input, this.maxOutputTokens);
    const conservativeCostUsd =
      (upperBound / 1_000_000) * Math.max(config.inputUsdPerMillion, config.outputUsdPerMillion);
    return Math.max(1, providerCostToAiPoints({
      providerCostUsd: conservativeCostUsd,
      outputUsdPerMillion: config.outputUsdPerMillion,
    }));
  }

  async edit(
    input: WorklogLineRecordEditProviderInput,
    config: WorklogAiRuntimeConfigSnapshot,
  ): Promise<WorklogLineRecordEditProviderResponse> {
    this.assertConfig(config);
    const requestBody = buildGeminiWorklogLineEditRequestBody(input, this.maxOutputTokens);
    const requestTokenUpperBound = new TextEncoder().encode(JSON.stringify(requestBody)).byteLength;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.endpoint}/models/${encodeURIComponent(config.model.trim())}:generateContent`,
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
      throw new WorklogLineEditProviderError('GEMINI_NETWORK_ERROR', 'Gemini LINE edit request failed before a response was received');
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
      throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', 'Gemini LINE edit response body was not valid JSON');
    }

    const outputText = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!outputText) {
      throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', 'Gemini LINE edit response did not contain structured output');
    }

    let raw: unknown;
    try { raw = JSON.parse(outputText); }
    catch { throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', 'Gemini LINE edit structured output was not valid JSON'); }

    let parsed: z.infer<typeof structuredOutputSchema>;
    try { parsed = structuredOutputSchema.parse(raw); }
    catch { throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', 'Gemini LINE edit structured output failed schema validation'); }

    let output;
    try { output = normalizeWorklogLineRecordEditOutput(parsed); }
    catch (error) {
      throw new WorklogLineEditProviderError(
        'GEMINI_INVALID_RESPONSE',
        error instanceof Error ? error.message : 'Gemini LINE edit output was invalid',
      );
    }

    const inputTokens = safeTokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const candidateTokens = safeTokenCount(body.usageMetadata?.candidatesTokenCount, 'candidate output');
    const thoughtsTokens = optionalTokenCount(body.usageMetadata?.thoughtsTokenCount, 'thinking');
    if (inputTokens > requestTokenUpperBound) {
      throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', 'Gemini reported input token usage above conservative request-byte bound');
    }
    if (candidateTokens > this.maxOutputTokens) {
      throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', 'Gemini reported candidate output usage above configured maximum');
    }

    return {
      output,
      inputTokens,
      outputTokens: safeAddTokens(candidateTokens, thoughtsTokens, 'billed output'),
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs,
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot): void {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') {
      throw new WorklogLineEditProviderError('AI_PROVIDER_UNSUPPORTED', `Unsupported worklog AI provider: ${config.provider}`);
    }
    if (!this.options.apiKey.trim()) {
      throw new WorklogLineEditProviderError('GEMINI_CONFIG_INVALID', 'Gemini API key is required for Worklog LINE edit');
    }
    const model = config.model.trim();
    if (!model || model.length > 255) {
      throw new WorklogLineEditProviderError('GEMINI_CONFIG_INVALID', 'Gemini model name is required');
    }
    if (!Number.isFinite(config.inputUsdPerMillion) || config.inputUsdPerMillion < 0) {
      throw new WorklogLineEditProviderError('GEMINI_CONFIG_INVALID', 'Invalid Gemini input price');
    }
    if (!Number.isFinite(config.outputUsdPerMillion) || config.outputUsdPerMillion <= 0) {
      throw new WorklogLineEditProviderError('GEMINI_CONFIG_INVALID', 'Invalid Gemini output price');
    }
  }
}

function providerHttpError(status: number, detail: string): WorklogLineEditProviderError {
  if (status === 429) return new WorklogLineEditProviderError('GEMINI_RATE_LIMITED', detail || 'Gemini rate limited LINE edit');
  if (status === 401 || status === 403) return new WorklogLineEditProviderError('GEMINI_AUTH_FAILED', detail || 'Gemini authentication failed');
  if (status >= 500) return new WorklogLineEditProviderError('GEMINI_UPSTREAM_ERROR', detail || `Gemini HTTP ${status}`);
  return new WorklogLineEditProviderError('GEMINI_REQUEST_REJECTED', detail || `Gemini HTTP ${status}`);
}

function safeTokenCount(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} token usage is invalid`);
  }
  return value as number;
}

function optionalTokenCount(value: number | undefined, label: string): number {
  if (value === undefined) return 0;
  return safeTokenCount(value, label);
}

function safeAddTokens(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new WorklogLineEditProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} token usage is invalid`);
  }
  return total;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new WorklogLineEditProviderError('GEMINI_INPUT_INVALID', `${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new WorklogLineEditProviderError('GEMINI_INPUT_INVALID', `invalid ${label}`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(value, label, max);
}

function requiredDateTime(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new WorklogLineEditProviderError('GEMINI_INPUT_INVALID', `${label} must be RFC3339 text`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new WorklogLineEditProviderError('GEMINI_INPUT_INVALID', `invalid ${label}`);
  return parsed.toISOString();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new WorklogLineEditProviderError('GEMINI_CONFIG_INVALID', `${label} must be positive`);
  return value;
}
