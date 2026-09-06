import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import type {
  WorklogLineNaturalInterpreterInput,
  WorklogLineNaturalInterpreterProvider,
  WorklogLineNaturalInterpreterResponse,
  WorklogLineNaturalInterpretation,
} from './line-natural-interpreter';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class WorklogLineNaturalInterpreterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WorklogLineNaturalInterpreterError';
  }
}

export type GeminiWorklogLineNaturalInterpreterOptions = {
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

const PRODUCT_TIME_ZONE = 'Asia/Taipei';
const THINKING_LEVEL = 'low';
const intents = ['RECORD', 'QUERY', 'EDIT', 'DELETE', 'RESTORE', 'MOVE', 'SYSTEM_QUERY', 'UNKNOWN'] as const;
const systemQueries = ['AI_STATUS', 'AI_BALANCE', 'AI_RESPONSIBLE_USER'] as const;

const structuredOutputSchema = z.object({
  intent: z.enum(intents),
  record_content: z.string().trim().min(1).max(20_000).nullable(),
  record_title: z.string().trim().min(1).max(255).nullable(),
  record_title_requires_confirmation: z.boolean(),
  record_occurred_at: z.string().trim().min(1).max(64).nullable(),
  record_search_terms: z.array(z.string().trim().min(1).max(64)).max(12),
  query_text: z.string().trim().min(1).max(500).nullable(),
  edit_instruction: z.string().trim().min(1).max(4_000).nullable(),
  edit_raw_text: z.string().trim().min(1).max(20_000).nullable(),
  edit_occurred_at: z.string().trim().min(1).max(64).nullable(),
  edit_title: z.string().trim().min(1).max(255).nullable(),
  edit_title_requires_confirmation: z.boolean(),
  move_title: z.string().trim().min(1).max(255).nullable(),
  system_query: z.enum(systemQueries).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: [...intents] },
    record_content: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    record_title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    record_title_requires_confirmation: { type: 'boolean' },
    record_occurred_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    record_search_terms: { type: 'array', maxItems: 12, items: { type: 'string' } },
    query_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    edit_instruction: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    edit_raw_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    edit_occurred_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    edit_title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    edit_title_requires_confirmation: { type: 'boolean' },
    move_title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    system_query: { anyOf: [{ type: 'string', enum: [...systemQueries] }, { type: 'null' }] },
    reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'intent', 'record_content', 'record_title', 'record_title_requires_confirmation',
    'record_occurred_at', 'record_search_terms', 'query_text', 'edit_instruction',
    'edit_raw_text', 'edit_occurred_at', 'edit_title', 'edit_title_requires_confirmation',
    'move_title', 'system_query', 'reason',
  ],
} as const;

export function buildGeminiWorklogLineNaturalInterpreterRequestBody(
  input: WorklogLineNaturalInterpreterInput,
  maxOutputTokens = 512,
) {
  const text = requiredText(input.text, 'text', 20_000);
  const referenceOccurredAt = requiredDateTime(input.referenceOccurredAt, 'referenceOccurredAt');
  const target = input.target ?? null;
  const quotedText = input.quotedText?.trim() || null;
  const maxTokens = positiveInteger(maxOutputTokens, 'maxOutputTokens');

  return {
    systemInstruction: {
      parts: [{ text: [
        'You are the bounded natural-language interpreter for AFTERTRACE LINE assistant 小跡.',
        'Interpret exactly one user message into RECORD, QUERY, EDIT, DELETE, RESTORE, MOVE, SYSTEM_QUERY, or UNKNOWN.',
        'Do not call tools, answer the user, summarize historical records, or invent stored facts.',
        'RECORD preserves a work fact. Remove control wording such as 幫我記一下 while preserving durable content; also propose one filing title, optional date, and at most 12 grounded search terms.',
        `Resolve relative dates against reference_timestamp in ${PRODUCT_TIME_ZONE}; record_occurred_at must be YYYY-MM-DD or null when no date expression is present.`,
        'QUERY searches existing records. Put a concise natural query in query_text and preserve useful date words such as 今天、昨天、這週、最近.',
        'EDIT changes content/date and may also change title. It requires an exact backend target; never guess which Record.',
        'DELETE means soft-delete the exact replied-to Record. RESTORE means restore an exact replied-to deleted Record. Never infer a target from phrases such as 剛剛那筆 if no exact target is supplied.',
        'MOVE means change only the filing title/Entity of the exact replied-to Record while keeping its content/date unchanged. Put the requested destination title in move_title.',
        'SYSTEM_QUERY is only for AI operating facts: AI_STATUS means whether AI is usable/configured for this Source, AI_BALANCE means remaining AI points, AI_RESPONSIBLE_USER means who currently funds GROUP AI.',
        'If a Reply contains quoted ordinary text and the user asks to record it, use quoted_text as durable fact context.',
        'UNKNOWN is for genuinely ambiguous or unsupported requests. Do not silently convert uncertainty into RECORD.',
        'Fields unrelated to the chosen intent must still be present using null, false, or empty arrays as appropriate.',
      ].join(' ') }],
    },
    contents: [{
      role: 'user',
      parts: [{ text: [
        `reference_timestamp: ${referenceOccurredAt}`,
        `reference_timezone: ${PRODUCT_TIME_ZONE}`,
        `user_message: ${text}`,
        `quoted_text: ${quotedText ?? 'null'}`,
        target ? `target_record_text: ${target.rawText}` : 'target_record_text: null',
        target ? `target_record_occurred_at: ${target.occurredAt}` : 'target_record_occurred_at: null',
      ].join('\n') }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      maxOutputTokens: maxTokens,
    },
  };
}

export class GeminiWorklogLineNaturalInterpreter implements WorklogLineNaturalInterpreterProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiWorklogLineNaturalInterpreterOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 512, 'maxOutputTokens');
  }

  reservationPoints(input: WorklogLineNaturalInterpreterInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const requestBytes = new TextEncoder().encode(JSON.stringify(
      buildGeminiWorklogLineNaturalInterpreterRequestBody(input, this.maxOutputTokens),
    )).byteLength;
    const conservativeCostUsd = ((requestBytes + this.maxOutputTokens * 2) / 1_000_000) * Math.max(config.inputUsdPerMillion, config.outputUsdPerMillion);
    return Math.max(1, providerCostToAiPoints({ providerCostUsd: conservativeCostUsd, outputUsdPerMillion: config.outputUsdPerMillion }));
  }

  async interpret(input: WorklogLineNaturalInterpreterInput, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogLineNaturalInterpreterResponse> {
    this.assertConfig(config);
    const requestBody = buildGeminiWorklogLineNaturalInterpreterRequestBody(input, this.maxOutputTokens);
    const requestTokenUpperBound = new TextEncoder().encode(JSON.stringify(requestBody)).byteLength;
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(config.model.trim())}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey.trim() },
        body: JSON.stringify(requestBody),
      });
    } catch {
      throw new WorklogLineNaturalInterpreterError('GEMINI_NETWORK_ERROR', 'Gemini LINE interpreter request failed');
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) throw new WorklogLineNaturalInterpreterError(`GEMINI_HTTP_${response.status}`, (await response.text()).slice(0, 500));

    let body: GeminiGenerateContentResponse;
    try { body = (await response.json()) as GeminiGenerateContentResponse; }
    catch { throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'Gemini response was not JSON'); }

    const outputText = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!outputText) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'Gemini returned no structured output');

    let raw: unknown;
    try { raw = JSON.parse(outputText); }
    catch { throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'Gemini structured output was invalid JSON'); }

    let parsed: z.infer<typeof structuredOutputSchema>;
    try { parsed = structuredOutputSchema.parse(raw); }
    catch { throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'Gemini structured output failed schema validation'); }

    const inputTokens = safeTokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const candidateTokens = safeTokenCount(body.usageMetadata?.candidatesTokenCount, 'candidate output');
    const thoughtsTokens = optionalTokenCount(body.usageMetadata?.thoughtsTokenCount, 'thinking');
    if (inputTokens > requestTokenUpperBound) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'reported input usage exceeds conservative bound');
    if (candidateTokens > this.maxOutputTokens) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'reported output usage exceeds configured maximum');

    return {
      interpretation: normalizeInterpretation(parsed, input),
      inputTokens,
      outputTokens: safeAdd(candidateTokens, thoughtsTokens),
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs,
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot): void {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') throw new WorklogLineNaturalInterpreterError('AI_PROVIDER_UNSUPPORTED', 'unsupported AI provider');
    if (!this.options.apiKey.trim()) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', 'Gemini API key is required');
    if (!config.model.trim()) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', 'Gemini model is required');
    if (!Number.isFinite(config.inputUsdPerMillion) || config.inputUsdPerMillion < 0) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', 'invalid input price');
    if (!Number.isFinite(config.outputUsdPerMillion) || config.outputUsdPerMillion <= 0) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', 'invalid output price');
  }
}

function normalizeInterpretation(parsed: z.infer<typeof structuredOutputSchema>, input: WorklogLineNaturalInterpreterInput): WorklogLineNaturalInterpretation {
  if (parsed.intent === 'RECORD') {
    if (!parsed.record_content) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'RECORD requires record_content');
    return { intent: 'RECORD', content: parsed.record_content, record: { title: parsed.record_title, titleRequiresConfirmation: parsed.record_title_requires_confirmation, occurredAt: normalizeDay(parsed.record_occurred_at), searchTerms: dedupeTerms(parsed.record_search_terms) } };
  }
  if (parsed.intent === 'QUERY') return { intent: 'QUERY', queryText: parsed.query_text };
  if (parsed.intent === 'EDIT') {
    if (!parsed.edit_instruction) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'EDIT requires edit_instruction');
    const targetText = input.target?.rawText ?? null;
    return { intent: 'EDIT', instruction: parsed.edit_instruction, edit: { rawText: parsed.edit_raw_text ?? targetText ?? parsed.edit_instruction, occurredAt: normalizeDay(parsed.edit_occurred_at), title: parsed.edit_title, titleRequiresConfirmation: parsed.edit_title_requires_confirmation } };
  }
  if (parsed.intent === 'DELETE') return { intent: 'DELETE' };
  if (parsed.intent === 'RESTORE') return { intent: 'RESTORE' };
  if (parsed.intent === 'MOVE') {
    if (!parsed.move_title) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'MOVE requires move_title');
    return { intent: 'MOVE', title: parsed.move_title };
  }
  if (parsed.intent === 'SYSTEM_QUERY') {
    if (!parsed.system_query) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'SYSTEM_QUERY requires system_query');
    return { intent: 'SYSTEM_QUERY', query: parsed.system_query };
  }
  return { intent: 'UNKNOWN', reason: parsed.reason };
}

function normalizeDay(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateOnly) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'event date must be YYYY-MM-DD');
  const [year, month, day] = dateOnly.slice(1).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 8 * 60 * 60 * 1000);
  const roundTrip = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() + 1 !== month || roundTrip.getUTCDate() !== day) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'invalid event date');
  return utc.toISOString();
}

function dedupeTerms(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (!item) continue;
    const key = item.toLocaleLowerCase('zh-TW');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= 12) break;
  }
  return result;
}

function requiredText(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', `invalid ${label}`);
  return normalized;
}
function requiredDateTime(value: string, label: string): string {
  const normalized = requiredText(value, label, 128);
  if (!Number.isFinite(new Date(normalized).getTime())) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', `invalid ${label}`);
  return normalized;
}
function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new WorklogLineNaturalInterpreterError('GEMINI_CONFIG_INVALID', `invalid ${label}`);
  return value;
}
function safeTokenCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', `invalid ${label} token count`);
  return value;
}
function optionalTokenCount(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0;
  return safeTokenCount(value, label);
}
function safeAdd(a: number, b: number): number {
  const value = a + b;
  if (!Number.isSafeInteger(value) || value < 0) throw new WorklogLineNaturalInterpreterError('GEMINI_INVALID_RESPONSE', 'invalid billed output token count');
  return value;
}
