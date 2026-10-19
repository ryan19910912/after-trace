import { z } from 'zod';
import { providerCostToAiPoints } from './ai-points';
import type { AiTaskProposalProvider, AiTaskProposalProviderInput, AiTaskProposalProviderResponse } from './ai-task-proposal';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class GeminiTaskProposalError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'GeminiTaskProposalError'; }
}

const outputSchema = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().max(10_000).nullable(),
  due_at: z.string().datetime({ offset: true }).nullable(),
  remind_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    body: { type: ['string', 'null'] },
    due_at: { type: ['string', 'null'], format: 'date-time' },
    remind_at: { type: ['string', 'null'], format: 'date-time' },
  },
  required: ['title', 'body', 'due_at', 'remind_at'],
} as const;

export class GeminiWorklogTaskProposer implements AiTaskProposalProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: { apiKey: string; maxOutputTokens?: number; endpoint?: string; fetchFn?: typeof fetch }) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 900);
  }

  reservationPoints(input: AiTaskProposalProviderInput, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const recordText = input.record?.rawText ?? '';
    const estimatedInputTokens = Math.ceil((input.text.length + recordText.length) / 2) + 1000;
    const cost = (estimatedInputTokens / 1_000_000) * config.inputUsdPerMillion
      + (this.maxOutputTokens / 1_000_000) * config.outputUsdPerMillion;
    return Math.max(1, providerCostToAiPoints({ providerCostUsd: cost, outputUsdPerMillion: config.outputUsdPerMillion }));
  }

  async propose(input: AiTaskProposalProviderInput, config: WorklogAiRuntimeConfigSnapshot): Promise<AiTaskProposalProviderResponse> {
    this.assertConfig(config);
    const startedAt = Date.now();
    const recordContext = input.record
      ? `\n\n參考紀錄（只能作為事實背景，不代表一定要建立任務）：\n${input.record.rawText}`
      : '';
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(config.model.trim())}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: [
            'You propose one AFTERTRACE task from the user request. Do not create or execute anything.',
            'Return Traditional Chinese unless preserving a proper noun requires otherwise.',
            'Never invent a due/reminder time. Set due_at/remind_at to null unless the user text explicitly expresses or clearly implies that time.',
            'Resolve relative time only against the supplied reference timestamp and timezone.',
            'Keep title concise and body factual. Do not claim work is completed.',
          ].join(' ') }] },
          contents: [{ role: 'user', parts: [{ text: [
            `reference_at=${input.referenceAt.toISOString()}`,
            `time_zone=${input.timeZone}`,
            `使用者需求：${input.text}`,
            recordContext,
          ].join('\n') }] }],
          generationConfig: {
            responseMimeType: 'application/json', responseJsonSchema,
            thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: this.maxOutputTokens,
          },
        }),
      });
    } catch {
      throw new GeminiTaskProposalError('GEMINI_NETWORK_ERROR', 'Gemini task proposal request failed before response');
    }
    if (!response.ok) throw providerHttpError(response.status, (await response.text()).slice(0, 500));

    let body: { responseId?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    try { body = await response.json(); }
    catch { throw new GeminiTaskProposalError('GEMINI_INVALID_RESPONSE', 'Gemini task proposal response is not JSON'); }
    const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!raw) throw new GeminiTaskProposalError('GEMINI_INVALID_RESPONSE', 'Gemini task proposal output missing');
    let parsed: z.infer<typeof outputSchema>;
    try { parsed = outputSchema.parse(JSON.parse(raw)); }
    catch { throw new GeminiTaskProposalError('GEMINI_INVALID_RESPONSE', 'Gemini task proposal structured output invalid'); }
    const inputTokens = token(body.usageMetadata?.promptTokenCount);
    const candidateTokens = token(body.usageMetadata?.candidatesTokenCount);
    const thoughtsTokens = body.usageMetadata?.thoughtsTokenCount == null ? 0 : token(body.usageMetadata.thoughtsTokenCount);
    const outputTokens = candidateTokens + thoughtsTokens;
    if (!Number.isSafeInteger(outputTokens) || candidateTokens > this.maxOutputTokens) throw new GeminiTaskProposalError('GEMINI_INVALID_RESPONSE', 'Gemini task proposal usage invalid');
    return {
      title: parsed.title,
      body: parsed.body,
      dueAt: parsed.due_at,
      remindAt: parsed.remind_at,
      inputTokens,
      outputTokens,
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot) {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') throw new GeminiTaskProposalError('AI_PROVIDER_UNSUPPORTED', 'Unsupported provider');
    if (!this.options.apiKey.trim() || !config.model.trim()) throw new GeminiTaskProposalError('GEMINI_CONFIG_INVALID', 'Gemini config incomplete');
    if (!Number.isFinite(config.inputUsdPerMillion) || config.inputUsdPerMillion < 0 || !Number.isFinite(config.outputUsdPerMillion) || config.outputUsdPerMillion <= 0) throw new GeminiTaskProposalError('GEMINI_CONFIG_INVALID', 'Gemini pricing invalid');
  }
}

function providerHttpError(status: number, detail: string) {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return new GeminiTaskProposalError('GEMINI_AUTH_REJECTED', `Gemini authentication rejected (${status})${suffix}`);
  if (status === 404) return new GeminiTaskProposalError('GEMINI_MODEL_NOT_FOUND', `Gemini model not found (${status})${suffix}`);
  if (status === 429) return new GeminiTaskProposalError('GEMINI_RATE_LIMITED', `Gemini rate limited (${status})${suffix}`);
  if (status >= 500) return new GeminiTaskProposalError('GEMINI_UPSTREAM_FAILURE', `Gemini upstream failed (${status})${suffix}`);
  return new GeminiTaskProposalError('GEMINI_REQUEST_REJECTED', `Gemini request rejected (${status})${suffix}`);
}
function token(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new GeminiTaskProposalError('GEMINI_INVALID_RESPONSE', 'Gemini usage missing'); return value; }
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new GeminiTaskProposalError('GEMINI_CONFIG_INVALID', 'maxOutputTokens invalid'); return value; }
