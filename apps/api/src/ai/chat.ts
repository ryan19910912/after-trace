import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { aiCostTwdToEnergyUnits, resolveAiEnergyMeter, type AiEnergyMeterEnv } from '../energy/ai-meter';
import { DrizzleExplicitAiEnergyHoldRepository } from '../energy/explicit-ai-hold';
import { calculateAiCost } from './cost';
import { resolveAiRuntimeConfig, type AiRuntimeEnv } from './runtime-config';

export type ExplicitAiChatEnv = AiRuntimeEnv & AiEnergyMeterEnv & {
  GEMINI_API_KEY?: string;
  GEMINI_CHAT_MAX_OUTPUT_TOKENS?: string;
};

type ChatRequest = {
  id: number;
  userId: number;
  status: string;
  responseText: string | null;
};

type ContextMessage = {
  lineUserId: string | null;
  text: string;
};

type ActiveMemory = {
  category: string;
  subject: string | null;
  content: string;
};

export type ExplicitAiChatResult =
  | { status: 'ANSWERED' | 'ALREADY_ANSWERED'; text: string }
  | { status: 'INSUFFICIENT_ENERGY' }
  | { status: 'DISABLED'; reason: string }
  | { status: 'FAILED'; code: string };

export class ExplicitAiChatService {
  private readonly runtime;
  private readonly meter;
  private readonly maxOutputTokens: number;
  private readonly holds: DrizzleExplicitAiEnergyHoldRepository;

  constructor(
    private readonly db: Database,
    private readonly env: ExplicitAiChatEnv,
  ) {
    this.runtime = resolveAiRuntimeConfig(env);
    this.meter = resolveAiEnergyMeter(env);
    this.maxOutputTokens = configuredMaxOutputTokens(env.GEMINI_CHAT_MAX_OUTPUT_TOKENS);
    this.holds = new DrizzleExplicitAiEnergyHoldRepository(db);
    if (!env.GEMINI_API_KEY?.trim()) throw new Error('GEMINI_API_KEY is required');
  }

  async answer(input: {
    groupId: number;
    lineUserId: string;
    lineMessageId: string;
    text: string;
    at: Date;
  }): Promise<ExplicitAiChatResult> {
    const prompt = stripMention(input.text);
    if (!prompt) return { status: 'FAILED', code: 'EMPTY_AI_PROMPT' };
    const request = await this.ensureRequest(input.groupId, input.lineUserId, input.lineMessageId, prompt, input.at);
    if (!request) return { status: 'FAILED', code: 'AI_CHAT_USER_NOT_FOUND' };
    if (request.status === 'SUCCEEDED' && request.responseText) {
      return { status: 'ALREADY_ANSWERED', text: request.responseText };
    }

    const context = await this.loadContext(input.groupId, input.lineMessageId);
    const providerPayload = buildPrompt(prompt, context.messages, context.memories);
    const inputUpperBoundTokens = new TextEncoder().encode(providerPayload).byteLength;
    const maxCost = calculateAiCost(
      { inputTokens: inputUpperBoundTokens, outputTokens: this.maxOutputTokens },
      this.runtime.pricing,
    );
    const maxEnergyUnits = aiCostTwdToEnergyUnits(maxCost.costTwd, this.meter);
    const hold = await this.holds.reserve({
      requestId: request.id,
      userId: request.userId,
      maxUnits: maxEnergyUnits,
      at: input.at,
    });
    if (hold.status === 'INSUFFICIENT_ENERGY') return { status: 'INSUFFICIENT_ENERGY' };
    if (hold.status === 'REFERENCE_CONFLICT') return { status: 'FAILED', code: 'AI_CHAT_HOLD_CONFLICT' };

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.runtime.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.env.GEMINI_API_KEY!.trim(),
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: 'You are AFTERTRACE, a concise assistant inside one LINE group. Answer the user using supplied recent group context and durable memories when relevant. Do not claim facts not grounded in the supplied context. Never expose internal LINE user ids, billing internals, or hidden identifiers. Reply in the language used by the caller.',
              }],
            },
            contents: [{ role: 'user', parts: [{ text: providerPayload }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: this.maxOutputTokens,
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`GEMINI_HTTP_${response.status}`);
      }
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const answer = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
      const inputTokens = body.usageMetadata?.promptTokenCount;
      const outputTokens = body.usageMetadata?.candidatesTokenCount;
      if (!answer || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
        throw new Error('GEMINI_INVALID_CHAT_RESPONSE');
      }
      const actual = calculateAiCost(
        { inputTokens: inputTokens!, outputTokens: outputTokens! },
        this.runtime.pricing,
      );
      const actualUnits = aiCostTwdToEnergyUnits(actual.costTwd, this.meter);
      if (actualUnits > maxEnergyUnits) throw new Error('AI_CHAT_COST_EXCEEDED_HOLD');
      const settlement = await this.holds.settle({
        requestId: request.id,
        userId: request.userId,
        actualUnits,
        at: new Date(),
      });
      if (settlement.status !== 'SETTLED' && settlement.status !== 'ALREADY_SETTLED') {
        throw new Error('AI_CHAT_SETTLEMENT_FAILED');
      }
      await this.completeRequest({
        requestId: request.id,
        answer: answer.slice(0, 10_000),
        inputTokens: inputTokens!,
        outputTokens: outputTokens!,
        costTwd: actual.costTwd.toFixed(8),
        energyUnits: actualUnits,
        at: new Date(),
      });
      return { status: 'ANSWERED', text: answer.slice(0, 5_000) };
    } catch (error) {
      await this.holds.release({ requestId: request.id, userId: request.userId, at: new Date() }).catch(() => undefined);
      const code = error instanceof Error ? error.message.slice(0, 128) : 'AI_CHAT_FAILED';
      await this.failRequest(request.id, code, new Date()).catch(() => undefined);
      return { status: 'FAILED', code };
    }
  }

  private async ensureRequest(
    groupId: number,
    lineUserId: string,
    lineMessageId: string,
    prompt: string,
    at: Date,
  ): Promise<ChatRequest | null> {
    const result = await this.db.execute(sql`
      WITH user_row AS (
        SELECT id FROM line_users WHERE line_user_id = ${lineUserId} LIMIT 1
      ), inserted AS (
        INSERT INTO explicit_ai_chat_requests (
          group_id, user_id, line_message_id, prompt, status, created_at, updated_at
        )
        SELECT ${groupId}, id, ${lineMessageId}, ${prompt}, 'PENDING', ${at}, ${at}
        FROM user_row
        ON CONFLICT (group_id, line_message_id) DO NOTHING
        RETURNING id, user_id, status, response_text
      ), selected AS (
        SELECT id, user_id, status, response_text FROM inserted
        UNION ALL
        SELECT id, user_id, status, response_text
        FROM explicit_ai_chat_requests
        WHERE group_id = ${groupId} AND line_message_id = ${lineMessageId}
          AND NOT EXISTS (SELECT 1 FROM inserted)
      )
      SELECT id::text AS id, user_id::text AS user_id, status, response_text
      FROM selected LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; user_id?: string; status?: string; response_text?: string | null } | undefined;
    if (!row?.id || !row.user_id || !row.status) return null;
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      status: row.status,
      responseText: row.response_text ?? null,
    };
  }

  private async loadContext(groupId: number, currentLineMessageId: string): Promise<{
    messages: ContextMessage[];
    memories: ActiveMemory[];
  }> {
    const [messagesResult, memoriesResult] = await Promise.all([
      this.db.execute(sql`
        SELECT line_user_id, text_content
        FROM conversation_messages
        WHERE group_id = ${groupId}
          AND message_type = 'text'
          AND text_content IS NOT NULL
          AND line_message_id <> ${currentLineMessageId}
        ORDER BY line_timestamp DESC, id DESC
        LIMIT 24
      `),
      this.db.execute(sql`
        SELECT category, subject, content
        FROM memories
        WHERE group_id = ${groupId}
          AND status = 'ACTIVE'
        ORDER BY updated_at DESC, id DESC
        LIMIT 40
      `),
    ]);
    return {
      messages: messagesResult.rows.reverse().map((raw) => {
        const row = raw as { line_user_id: string | null; text_content: string };
        return { lineUserId: row.line_user_id, text: row.text_content };
      }),
      memories: memoriesResult.rows.map((raw) => raw as ActiveMemory),
    };
  }

  private async completeRequest(input: {
    requestId: number;
    answer: string;
    inputTokens: number;
    outputTokens: number;
    costTwd: string;
    energyUnits: bigint;
    at: Date;
  }): Promise<void> {
    await this.db.execute(sql`
      UPDATE explicit_ai_chat_requests
      SET status = 'SUCCEEDED',
          response_text = ${input.answer},
          provider = 'GOOGLE',
          model = ${this.runtime.model},
          input_tokens = ${input.inputTokens},
          output_tokens = ${input.outputTokens},
          cost_twd = CAST(${input.costTwd} AS numeric),
          energy_units = ${input.energyUnits.toString()}::bigint,
          last_error_code = NULL,
          updated_at = ${input.at}
      WHERE id = ${input.requestId}
    `);
  }

  private async failRequest(requestId: number, code: string, at: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE explicit_ai_chat_requests
      SET status = 'FAILED', last_error_code = ${code}, updated_at = ${at}
      WHERE id = ${requestId}
        AND status <> 'SUCCEEDED'
    `);
  }
}

export function explicitAiChatDisabledReason(env: ExplicitAiChatEnv): string | null {
  const required = [
    'GEMINI_API_KEY',
    'GEMINI_INPUT_USD_PER_MILLION_TOKENS',
    'GEMINI_OUTPUT_USD_PER_MILLION_TOKENS',
    'USD_TWD_RATE',
    'ENERGY_UNITS_PER_TWD',
  ] as const;
  const missing = required.filter((key) => !env[key]?.trim());
  return missing.length ? `missing runtime config: ${missing.join(', ')}` : null;
}

function configuredMaxOutputTokens(value: string | undefined): number {
  if (!value?.trim()) return 512;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 4096) {
    throw new Error('GEMINI_CHAT_MAX_OUTPUT_TOKENS must be an integer between 1 and 4096');
  }
  return parsed;
}

function stripMention(value: string): string {
  return value.trim().replace(/^@(?:AI|AFTERTRACE)\b[\s,:：-]*/i, '').trim();
}

function buildPrompt(question: string, messages: ContextMessage[], memories: ActiveMemory[]): string {
  const aliases = new Map<string, string>();
  const promptMessages = messages.map((message) => {
    let speaker: string | null = null;
    if (message.lineUserId) {
      if (!aliases.has(message.lineUserId)) aliases.set(message.lineUserId, `speaker-${aliases.size + 1}`);
      speaker = aliases.get(message.lineUserId)!;
    }
    return { speaker, text: message.text };
  });
  return JSON.stringify({
    question,
    recentGroupMessages: promptMessages,
    activeMemories: memories,
  });
}
