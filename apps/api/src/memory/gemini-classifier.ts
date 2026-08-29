import { buildMemoryClassifierPrompt } from './classifier-prompt';
import {
  memoryClassifierOutputSchema,
  parseMemoryClassifierOutput,
  type MemoryClassifierPort,
  type MemoryClassifierResponse,
} from './classifier-contract';
import type { MemoryClassificationInput } from './classification-input';

export type GeminiClassifierOptions = { apiKey: string; model: string; endpoint?: string; fetchFn?: typeof fetch };
type GeminiGenerateContentResponse = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

const responseJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: { candidates: { type: 'array', maxItems: 20, items: {
    type: 'object', additionalProperties: false,
    properties: {
      candidateIndex: { type: 'integer', minimum: 0 },
      decision: { type: 'string', enum: ['NEW', 'DUPLICATE', 'UPDATE', 'CONTRADICT'] },
      targetMemoryId: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
      category: { type: 'string' },
      subject: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      content: { type: 'string' },
      sourceConversationMessageId: { type: 'integer', minimum: 1 },
    },
    required: ['candidateIndex', 'decision', 'targetMemoryId', 'category', 'subject', 'content', 'sourceConversationMessageId'],
  } } }, required: ['candidates'],
} as const;

export class GeminiMemoryClassifier implements MemoryClassifierPort {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: GeminiClassifierOptions) {
    if (!options.apiKey.trim()) throw new Error('Gemini API key is required');
    if (!options.model.trim()) throw new Error('Gemini model is required');
    this.fetchFn = options.fetchFn ?? fetch;
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async classify(input: MemoryClassificationInput): Promise<MemoryClassifierResponse> {
    const prompt = buildMemoryClassifierPrompt(input);
    const startedAt = Date.now();
    const response = await this.fetchFn(`${this.endpoint}/models/${encodeURIComponent(this.options.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: prompt.userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema, temperature: 0.1 },
      }),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      throw new Error(`Gemini generateContent failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as GeminiGenerateContentResponse;
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new Error('Gemini response did not contain classifier JSON text');
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('Gemini classifier response was not valid JSON'); }
    const output = memoryClassifierOutputSchema.parse(raw);
    parseMemoryClassifierOutput(output, input);

    const inputTokens = body.usageMetadata?.promptTokenCount;
    const outputTokens = body.usageMetadata?.candidatesTokenCount;
    if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0) {
      throw new Error('Gemini response is missing valid prompt token usage');
    }
    if (typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
      throw new Error('Gemini response is missing valid output token usage');
    }

    return { output, tokenUsage: { inputTokens, outputTokens }, model: this.options.model, providerResponseId: body.responseId ?? null, latencyMs };
  }
}
