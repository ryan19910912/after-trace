import { z } from 'zod';
import { base64ToUtf8, type LineMessageContent } from '../line/content';
import type {
  WorklogAttachmentInputType,
  WorklogAttachmentOutput,
  WorklogAttachmentProvider,
  WorklogAttachmentProviderResponse,
} from './attachment-ingestion';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export class WorklogAttachmentProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WorklogAttachmentProviderError';
  }
}

export type GeminiWorklogAttachmentOptions = {
  apiKey: string;
  maxOutputTokens?: number;
  endpoint?: string;
  fetchFn?: typeof fetch;
};

const outputSchema = z.object({
  raw_text: z.string().trim().min(1).max(20_000),
  summary: z.string().trim().min(1).max(2_000),
  category: z.enum(['NOTE', 'WORK', 'ISSUE', 'PAYMENT', 'EXPENSE', 'MATERIAL', 'OTHER']),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    raw_text: { type: 'string', description: 'Faithful transcript, extracted visible text, or factual description of the attachment. Do not invent details.' },
    summary: { type: 'string', description: 'Concise Traditional Chinese summary grounded only in the attachment.' },
    category: { type: 'string', enum: ['NOTE', 'WORK', 'ISSUE', 'PAYMENT', 'EXPENSE', 'MATERIAL', 'OTHER'] },
  },
  required: ['raw_text', 'summary', 'category'],
} as const;

type GeminiResponse = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export class GeminiWorklogAttachmentNormalizer implements WorklogAttachmentProvider {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: GeminiWorklogAttachmentOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.maxOutputTokens = positiveInteger(options.maxOutputTokens ?? 768, 'maxOutputTokens');
  }

  reservationUnits(content: LineMessageContent, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    const overhead = 8_000 + this.maxOutputTokens;
    const total = content.byteLength + overhead;
    if (!Number.isSafeInteger(total) || total <= 0) throw new WorklogAttachmentProviderError('AI_RESERVATION_ESTIMATE_INVALID', 'attachment reservation estimate invalid');
    return total;
  }

  async analyze(
    content: LineMessageContent,
    config: WorklogAiRuntimeConfigSnapshot,
    instruction?: string | null,
  ): Promise<WorklogAttachmentProviderResponse> {
    this.assertConfig(config);
    const inputType = attachmentType(content.mimeType);
    const request = buildRequest(content, inputType, instruction, this.maxOutputTokens);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(config.model)}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.options.apiKey.trim(),
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new WorklogAttachmentProviderError('GEMINI_NETWORK_ERROR', 'Gemini attachment request failed before response');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw providerHttpError(response.status, detail);
    }

    let body: GeminiResponse;
    try { body = await response.json() as GeminiResponse; }
    catch { throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini attachment response is not JSON'); }

    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini attachment output missing');
    let parsed: z.infer<typeof outputSchema>;
    try { parsed = outputSchema.parse(JSON.parse(text)); }
    catch { throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini attachment structured output invalid'); }

    const inputTokens = safeTokenCount(body.usageMetadata?.promptTokenCount, 'prompt');
    const outputTokens = safeTokenCount(body.usageMetadata?.candidatesTokenCount, 'output');
    if (outputTokens > this.maxOutputTokens) throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini attachment output usage exceeds configured maximum');

    const output: WorklogAttachmentOutput = {
      inputType,
      rawText: parsed.raw_text,
      summary: parsed.summary,
      category: parsed.category,
      attachmentMetadata: {
        mimeType: content.mimeType,
        byteLength: content.byteLength,
        source: 'LINE_CONTENT_API',
      },
    };
    return {
      output,
      inputTokens,
      outputTokens,
      audioInputUnits: inputType === 'AUDIO' ? inputTokens : 0,
      imageInputUnits: inputType === 'IMAGE' ? inputTokens : 0,
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot) {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') throw new WorklogAttachmentProviderError('AI_PROVIDER_UNSUPPORTED', `Unsupported provider: ${config.provider}`);
    if (!this.options.apiKey.trim()) throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', 'Gemini API key required');
    if (!config.model.trim()) throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', 'Gemini model required');
  }
}

function buildRequest(content: LineMessageContent, inputType: WorklogAttachmentInputType, instruction: string | null | undefined, maxOutputTokens: number) {
  const userParts: Array<Record<string, unknown>> = [];
  const textFile = inputType === 'FILE' && isTextLike(content.mimeType);
  if (textFile) {
    const decoded = base64ToUtf8(content.dataBase64).slice(0, 100_000);
    userParts.push({ text: `檔案內容：\n${decoded}` });
  } else {
    userParts.push({ inlineData: { mimeType: content.mimeType, data: content.dataBase64 } });
  }
  if (instruction?.trim()) userParts.push({ text: `使用者補充指示：${instruction.trim().slice(0, 1000)}` });

  return {
    systemInstruction: { parts: [{ text: [
      'You convert a LINE attachment into a durable AFTERTRACE work record.',
      'For audio, transcribe faithfully. For images, extract visible text and describe only factual visible work-related details. For PDF/files, extract useful readable content.',
      'Never invent customer names, amounts, dates, work completion, defects, or other facts.',
      'Return concise Traditional Chinese unless preserving source wording is useful.',
    ].join(' ') }] },
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      temperature: 0.1,
      maxOutputTokens,
    },
  };
}

function attachmentType(mimeType: string): WorklogAttachmentInputType {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf' || isTextLike(mime)) return 'FILE';
  if (mime.includes('wordprocessingml') || mime.includes('spreadsheetml') || mime.includes('msword') || mime.includes('excel')) {
    throw new WorklogAttachmentProviderError('ATTACHMENT_UNSUPPORTED', 'Office files are not supported yet; convert to PDF or text');
  }
  throw new WorklogAttachmentProviderError('ATTACHMENT_UNSUPPORTED', `Unsupported attachment type: ${mimeType}`);
}

function isTextLike(mimeType: string) {
  const mime = mimeType.toLowerCase();
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'text/csv' || mime === 'text/markdown';
}

function providerHttpError(status: number, detail: string) {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return new WorklogAttachmentProviderError('GEMINI_AUTH_REJECTED', `Gemini authentication rejected (${status})${suffix}`);
  if (status === 404) return new WorklogAttachmentProviderError('GEMINI_MODEL_NOT_FOUND', `Gemini model not found (${status})${suffix}`);
  if (status === 429) return new WorklogAttachmentProviderError('GEMINI_RATE_LIMITED', `Gemini rate limited request (${status})${suffix}`);
  if (status >= 500) return new WorklogAttachmentProviderError('GEMINI_UPSTREAM_FAILURE', `Gemini upstream failed (${status})${suffix}`);
  return new WorklogAttachmentProviderError('GEMINI_REQUEST_REJECTED', `Gemini request rejected (${status})${suffix}`);
}

function safeTokenCount(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} usage missing`);
  return value;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', `${label} invalid`);
  return value;
}
