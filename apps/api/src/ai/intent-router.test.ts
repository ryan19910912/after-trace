import { describe, expect, it, vi } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import { GeminiAiIntentRouter } from './intent-router';

function message(text: string, quotedLineMessageId: string | null = null): BufferedGroupMessage {
  return {
    webhookEventId: 'evt-1',
    lineGroupId: 'group-1',
    lineMessageId: 'msg-1',
    quotedLineMessageId,
    lineUserId: 'user-1',
    messageType: 'text',
    textContent: text,
    charCount: text.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-08-30T12:00:00Z'),
    metadata: null,
  };
}

function fetchReturning(value: { intent: string; prefer_recent_image: boolean }) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.maxOutputTokens).toBe(64);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('GeminiAiIntentRouter', () => {
  it('routes natural remember language without application keyword parsing', async () => {
    const router = new GeminiAiIntentRouter(
      'test-key',
      'gemini-2.5-flash-lite',
      fetchReturning({ intent: 'REMEMBER', prefer_recent_image: false }),
    );
    await expect(router.route(message('@AFTERTRACE 幫我記錄一下', 'quoted-1'))).resolves.toEqual({
      intent: 'REMEMBER',
      preferRecentImage: false,
    });
  });

  it('can ask the explicit capture pipeline to use a recent image', async () => {
    const router = new GeminiAiIntentRouter(
      'test-key',
      'gemini-2.5-flash-lite',
      fetchReturning({ intent: 'REMEMBER', prefer_recent_image: true }),
    );
    await expect(router.route(message('@AFTERTRACE 幫我把這張行程圖記起來'))).resolves.toEqual({
      intent: 'REMEMBER',
      preferRecentImage: true,
    });
  });

  it('routes questions and reminders separately', async () => {
    const ask = new GeminiAiIntentRouter(
      'test-key',
      'gemini-2.5-flash-lite',
      fetchReturning({ intent: 'ASK', prefer_recent_image: false }),
    );
    const reminder = new GeminiAiIntentRouter(
      'test-key',
      'gemini-2.5-flash-lite',
      fetchReturning({ intent: 'REMINDER', prefer_recent_image: false }),
    );
    await expect(ask.route(message('@AFTERTRACE 我們上次去陶板屋是什麼時候'))).resolves.toMatchObject({ intent: 'ASK' });
    await expect(reminder.route(message('@AFTERTRACE 明天下午三點提醒我看醫生'))).resolves.toMatchObject({ intent: 'REMINDER' });
  });
});
