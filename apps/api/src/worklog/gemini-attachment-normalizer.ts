import { z } from 'zod';
import { base64ToUtf8, type LineMessageContent } from '../line/content';
import type {
  WorklogAttachmentInputType,
  WorklogAttachmentOutput,
  WorklogAttachmentProvider,
  WorklogAttachmentProviderResponse,
} from './attachment-ingestion';
import { providerCostToAiPoints } from './ai-points';
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

const STABLE_WORKLOG_MODEL = 'gemini-3.5-flash';
const THINKING_LEVEL = 'low';

const outputSchema = z.object({
  raw_text: z.string().trim().min(1).max(20_000),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    raw_text: {
      type: 'string',
      description: 'Faithful transcript, extracted visible text, or factual description of the attachment. Do not invent details.',
    },
  },
  required: ['raw_text'],
} as const;

type GeminiModalityTokenCount = {
  modality?: string;
  tokenCount?: number;
};

type GeminiResponse = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    promptTokensDetails?: GeminiModalityTokenCount[];
  };
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

  reservationPoints(content: LineMessageContent, config: WorklogAiRuntimeConfigSnapshot): number {
    this.assertConfig(config);
    // The binary byte length is intentionally treated as a conservative input-token
    // upper bound. Add request/output/thinking overhead, then price the whole upper
    // bound at the most expensive configured modality. This only sizes the hold;
    // actual customer points come from real provider cost after success.
    const outputBudget = this.maxOutputTokens;
    const upperBoundUnits = content.byteLength + 8_000 + outputBudget + outputBudget;
    if (!Number.isSafeInteger(upperBoundUnits) || upperBoundUnits <= 0) {
      throw new WorklogAttachmentProviderError('AI_RESERVATION_ESTIMATE_INVALID', 'attachment reservation estimate invalid');
    }
    const worstUsdPerMillion = Math.max(
      config.inputUsdPerMillion,
      config.outputUsdPerMillion,
      config.audioUsdPerMillion ?? 0,
      config.imageUsdPerMillion ?? 0,
    );
    const conservativeCostUsd = (upperBoundUnits / 1_000_000) * worstUsdPerMillion;
    return Math.max(1, providerCostToAiPoints({
      providerCostUsd: conservativeCostUsd,
      outputUsdPerMillion: config.outputUsdPerMillion,
    }));
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
    const candidateTokens = safeTokenCount(body.usageMetadata?.candidatesTokenCount, 'candidate output');
    const thoughtsTokens = optionalTokenCount(body.usageMetadata?.thoughtsTokenCount, 'thinking');
    if (candidateTokens > this.maxOutputTokens) {
      throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini attachment candidate output usage exceeds configured maximum');
    }
    const outputTokens = safeAddTokens(candidateTokens, thoughtsTokens, 'billed output');
    const modality = promptModalityUsage(body.usageMetadata?.promptTokensDetails, inputTokens);

    const output: WorklogAttachmentOutput = {
      inputType,
      rawText: parsed.raw_text,
      // Useful source metadata is kept only in the provider result while processing;
      // the MVP does not persist an attachment library/binary/summary metadata on Record.
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
      audioInputUnits: modality.audioInputUnits,
      imageInputUnits: modality.imageInputUnits,
      providerResponseId: body.responseId?.slice(0, 255) ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private assertConfig(config: WorklogAiRuntimeConfigSnapshot) {
    if (config.provider.trim().toUpperCase() !== 'GOOGLE') {
      throw new WorklogAttachmentProviderError('AI_PROVIDER_UNSUPPORTED', `Unsupported provider: ${config.provider}`);
    }
    if (!this.options.apiKey.trim()) {
      throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', 'Gemini API key required');
    }
    if (config.model.trim() !== STABLE_WORKLOG_MODEL) {
      throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', `Worklog currently supports only ${STABLE_WORKLOG_MODEL}`);
    }
    nonNegativeFinite(config.inputUsdPerMillion, 'inputUsdPerMillion');
    positiveFinite(config.outputUsdPerMillion, 'outputUsdPerMillion');
    if (config.audioUsdPerMillion !== null) nonNegativeFinite(config.audioUsdPerMillion, 'audioUsdPerMillion');
    if (config.imageUsdPerMillion !== null) nonNegativeFinite(config.imageUsdPerMillion, 'imageUsdPerMillion');
    if (config.usdTwdRate !== null) nonNegativeFinite(config.usdTwdRate, 'usdTwdRate');
  }
}

function buildRequest(
  content: LineMessageContent,
  inputType: WorklogAttachmentInputType,
  instruction: string | null | undefined,
  maxOutputTokens: number,
) {
  const userParts: Array<Record<string, unknown>> = [];
  const textFile = inputType === 'FILE' && isTextLike(content.mimeType);
  if (textFile) {
    const decoded = base64ToUtf8(content.dataBase64).slice(0, 100_000);
    userParts.push({ text: `檔案內容：\n${decoded}` });
  } else {
    userParts.push({ inlineData: { mimeType: content.mimeType, data: content.dataBase64 } });
  }
  if (instruction?.trim()) {
    userParts.push({ text: `使用者補充指示：${instruction.trim().slice(0, 1000)}` });
  }

  return {
    systemInstruction: { parts: [{ text: [
      'You convert a LINE attachment into durable AFTERTRACE Record text.',
      'For audio, transcribe faithfully. For images, extract visible text and describe only factual visible work details. For PDF/files, extract useful readable content.',
      'Never invent customer names, amounts, dates, completion, defects, or other facts.',
      'Do not create a category, summary, Customer, Project, payment or material schema. Return only the durable textual representation.',
      'Use Traditional Chinese when adding factual descriptions, while preserving useful source wording.',
    ].join(' ') }] },
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      maxOutputTokens,
    },
  };
}

function promptModalityUsage(
  details: GeminiModalityTokenCount[] | undefined,
  totalPromptTokens: number,
): { audioInputUnits: number; imageInputUnits: number } {
  if (!details || details.length === 0) return { audioInputUnits: 0, imageInputUnits: 0 };

  let detailTotal = 0;
  let audioInputUnits = 0;
  let imageInputUnits = 0;
  for (const detail of details) {
    const tokenCount = safeTokenCount(detail.tokenCount, 'prompt modality');
    detailTotal += tokenCount;
    if (!Number.isSafeInteger(detailTotal) || detailTotal < 0) {
      throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini modality usage overflow');
    }
    const modality = detail.modality?.trim().toUpperCase() ?? 'MODALITY_UNSPECIFIED';
    if (modality === 'AUDIO') audioInputUnits += tokenCount;
    if (modality === 'IMAGE') imageInputUnits += tokenCount;
  }
  if (detailTotal > totalPromptTokens) {
    throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', 'Gemini modality usage exceeds total prompt usage');
  }
  return { audioInputUnits, imageInputUnits };
}

function attachmentType(mimeType: string): WorklogAttachmentInputType {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf' || isTextLike(mime)) return 'FILE';
  if (mime.includes('wordprocessingml') || mime.includes('spreadsheetml') || mime.includes('msword') || mime.includes('excel')) {
    throw new WorklogAttachmentProviderError('ATTACHMENT_UNSUPPORTED', 'Office extraction is not implemented yet');
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
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} usage missing`);
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
    throw new WorklogAttachmentProviderError('GEMINI_INVALID_RESPONSE', `Gemini ${label} usage overflow`);
  }
  return total;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', `${label} invalid`);
  }
  return value;
}

function nonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', `${label} must be a non-negative finite number`);
  }
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new WorklogAttachmentProviderError('GEMINI_CONFIG_INVALID', `${label} must be a positive finite number`);
  }
}