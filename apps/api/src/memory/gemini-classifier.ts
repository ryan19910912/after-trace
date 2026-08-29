import { buildMemoryClassifierPrompt } from './classifier-prompt';
import {
  memoryClassifierOutputSchema,
  parseMemoryClassifierOutput,
  type MemoryClassifierOutput,
  type MemoryClassifierPort,
  type MemoryClassifierResponse,
} from './classifier-contract';
import type { MemoryClassificationInput } from './classification-input';
import { MemoryAiExecutionError } from './retry-policy';

export type GeminiClassifierOptions = {
  apiKey: string;
  model: string;
  endpoint?: string;
  fetchFn?: typeof fetch;
};

type GeminiGenerateContentResponse = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidateIndex: { type: 'integer', minimum: 0 },
          decision: { type: 'string', enum: ['NEW', 'DUPLICATE', 'UPDATE', 'CONTRADICT'] },
          targetMemoryId: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          category: { type: 'string' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          content: { type: 'string' },
          sourceConversationMessageId: { type: 'integer', minimum: 1 },
        },
        required: [
          'candidateIndex',
          'decision',
          'targetMemoryId',
          'category',
          'subject',
          'content',
          'sourceConversationMessageId',
        ],
      },
    },
  },
  required: ['candidates'],
} as const;

export class GeminiMemoryClassifier implements MemoryClassifierPort {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: GeminiClassifierOptions) {
    if (!options.apiKey.trim()) {
      throw new MemoryAiExecutionError(
        'GEMINI_CONFIG_INVALID',
        false,
        'Gemini API key is required',
      );
    }
    if (!options.model.trim()) {
      throw new MemoryAiExecutionError(
        'GEMINI_CONFIG_INVALID',
        false,
        'Gemini model is required',
      );
    }
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async classify(input: MemoryClassificationInput): Promise<MemoryClassifierResponse> {
    const prompt = buildMemoryClassifierPrompt(input);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.endpoint}/models/${encodeURIComponent(this.options.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: prompt.userPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema,
              temperature: 0.1,
            },
          }),
        },
      );
    } catch {
      throw new MemoryAiExecutionError(
        'GEMINI_NETWORK_ERROR',
        true,
        'Gemini generateContent network request failed',
      );
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      throw providerHttpError(response.status, text);
    }

    let body: GeminiGenerateContentResponse;
    try {
      body = (await response.json()) as GeminiGenerateContentResponse;
    } catch {
      throw new MemoryAiExecutionError(
        'GEMINI_INVALID_RESPONSE',
        true,
        'Gemini response body was not valid JSON',
      );
    }

    const text = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new MemoryAiExecutionError(
        'GEMINI_INVALID_RESPONSE',
        true,
        'Gemini response did not contain classifier JSON text',
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new MemoryAiExecutionError(
        'GEMINI_INVALID_RESPONSE',
        true,
        'Gemini classifier response was not valid JSON',
      );
    }

    let output: MemoryClassifierOutput;
    try {
      output = memoryClassifierOutputSchema.parse(raw);
      parseMemoryClassifierOutput(output, input);
    } catch {
      throw new MemoryAiExecutionError(
        'GEMINI_INVALID_RESPONSE',
        true,
        'Gemini classifier response failed structured or grounding validation',
      );
    }

    const inputTokens = body.usageMetadata?.promptTokenCount;
    const outputTokens = body.usageMetadata?.candidatesTokenCount;
    if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0) {
      throw new MemoryAiExecutionError(
        'GEMINI_INVALID_RESPONSE',
        true,
        'Gemini response is missing valid prompt token usage',
      );
    }
    if (typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
      throw new MemoryAiExecutionError(
        'GEMINI_INVALID_RESPONSE',
        true,
        'Gemini response is missing valid output token usage',
      );
    }

    return {
      output,
      tokenUsage: { inputTokens, outputTokens },
      model: this.options.model,
      providerResponseId: body.responseId ?? null,
      latencyMs,
    };
  }
}

function providerHttpError(status: number, detail: string): MemoryAiExecutionError {
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) {
    return new MemoryAiExecutionError(
      'GEMINI_AUTH_REJECTED',
      false,
      `Gemini authentication/authorization rejected (${status})${suffix}`,
    );
  }
  if (status === 400) {
    return new MemoryAiExecutionError(
      'GEMINI_BAD_REQUEST',
      false,
      `Gemini request was rejected as invalid (${status})${suffix}`,
    );
  }
  if (status === 404) {
    return new MemoryAiExecutionError(
      'GEMINI_MODEL_NOT_FOUND',
      false,
      `Gemini model/endpoint was not found (${status})${suffix}`,
    );
  }
  if (status === 408) {
    return new MemoryAiExecutionError(
      'GEMINI_TIMEOUT',
      true,
      `Gemini request timed out (${status})${suffix}`,
    );
  }
  if (status === 409 || status === 425 || status === 429 || status >= 500) {
    return new MemoryAiExecutionError(
      status === 429 ? 'GEMINI_RATE_LIMITED' : 'GEMINI_UPSTREAM_FAILURE',
      true,
      `Gemini transient request failure (${status})${suffix}`,
    );
  }
  if (status >= 400 && status < 500) {
    return new MemoryAiExecutionError(
      'GEMINI_REQUEST_REJECTED',
      false,
      `Gemini request was rejected (${status})${suffix}`,
    );
  }
  return new MemoryAiExecutionError(
    'GEMINI_UPSTREAM_FAILURE',
    true,
    `Gemini request failed (${status})${suffix}`,
  );
}
