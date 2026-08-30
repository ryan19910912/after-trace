import { z } from 'zod';
import type { BufferedGroupMessage } from '../line/events';
import { aiMentionText } from '../line/commands';

export type AiIntent = 'REMEMBER' | 'ASK' | 'REMINDER' | 'UNKNOWN';

export type AiIntentRoute = {
  intent: AiIntent;
  preferRecentImage: boolean;
};

export type AiIntentRouterEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

const routeSchema = z.object({
  intent: z.enum(['REMEMBER', 'ASK', 'REMINDER', 'UNKNOWN']),
  prefer_recent_image: z.boolean(),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['REMEMBER', 'ASK', 'REMINDER', 'UNKNOWN'] },
    prefer_recent_image: { type: 'boolean' },
  },
  required: ['intent', 'prefer_recent_image'],
} as const;

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

export class GeminiAiIntentRouter {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-3.5-flash-lite',
    private readonly fetcher: typeof fetch = runtimeFetch,
  ) {
    if (!apiKey.trim()) throw new Error('GEMINI_API_KEY is required for AI intent routing');
  }

  async route(message: BufferedGroupMessage): Promise<AiIntentRoute> {
    const text = aiMentionText(message);
    if (text === null) return { intent: 'UNKNOWN', preferRecentImage: false };

    const payload = {
      text,
      hasQuotedMessage: message.quotedLineMessageId !== null,
      currentMessageType: message.messageType,
    };
    const systemInstruction = [
      'You route natural-language commands addressed to AFTERTRACE in a LINE group.',
      'REMEMBER means the user explicitly wants information, a replied message, an image, itinerary, link, preference, plan, or other content saved to durable memory.',
      'ASK means the user wants an answer, explanation, lookup from group context, or ordinary AI assistance without explicitly asking to save it.',
      'REMINDER means the user asks AFTERTRACE to remind or notify them at a future time.',
      'UNKNOWN means the intent is genuinely unclear.',
      'prefer_recent_image=true only when the user clearly refers to a recent image/photo/screenshot/visual attachment and there is no quoted message. Otherwise false.',
      'Do not use keyword matching mechanically. Infer the user intent from natural language.',
    ].join(' ');

    const structured = await this.generate(systemInstruction, payload, true);
    if (structured.ok) return parseRoute(structured.body);

    console.warn(JSON.stringify({
      event: 'ai_intent_router_structured_retry',
      model: this.model,
      status: structured.status,
      detail: structured.detail,
    }));

    const fallbackInstruction = [
      systemInstruction,
      'Return only one compact JSON object and nothing else.',
      'The JSON shape must be exactly: {"intent":"REMEMBER|ASK|REMINDER|UNKNOWN","prefer_recent_image":true|false}.',
    ].join(' ');
    const fallback = await this.generate(fallbackInstruction, payload, false);
    if (!fallback.ok) {
      throw new Error(`AI_INTENT_ROUTER_FAILED_${fallback.status}: ${fallback.detail || 'unknown Gemini error'}`);
    }
    return parseRoute(fallback.body);
  }

  private async generate(systemInstruction: string, payload: unknown, structured: boolean): Promise<
    | { ok: true; body: GeminiResponse }
    | { ok: false; status: number; detail: string }
  > {
    const generationConfig: Record<string, unknown> = { temperature: 0, maxOutputTokens: 128 };
    if (structured) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = responseJsonSchema;
    }

    const response = await this.fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
          generationConfig,
        }),
      },
    );

    if (!response.ok) {
      return { ok: false, status: response.status, detail: (await response.text()).slice(0, 800) };
    }
    return { ok: true, body: (await response.json()) as GeminiResponse };
  }
}

function parseRoute(body: GeminiResponse): AiIntentRoute {
  const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!raw) throw new Error('AI_INTENT_ROUTER_EMPTY_RESPONSE');
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = routeSchema.parse(JSON.parse(cleaned));
  return { intent: parsed.intent, preferRecentImage: parsed.prefer_recent_image };
}

export function createAiIntentRouter(env: AiIntentRouterEnv): GeminiAiIntentRouter | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GeminiAiIntentRouter(apiKey, env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite');
}
