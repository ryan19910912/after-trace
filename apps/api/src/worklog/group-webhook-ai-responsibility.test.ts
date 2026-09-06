import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage, ParsedLineWebhook } from '../line/events';
import { processWorklogGroupWebhook } from './group-webhook';

describe('processWorklogGroupWebhook AI responsibility accounting', () => {
  it('counts AI_RESPONSIBILITY_BOUND for 小跡 啟用 AI without reviving Owner semantics', async () => {
    const textContent = '小跡 啟用 AI';
    const message: BufferedGroupMessage = {
      webhookEventId: 'event-claim-1',
      replyToken: 'reply-claim-1',
      lineGroupId: 'C11111111111111111111111111111111',
      lineMessageId: 'message-claim-1',
      quotedLineMessageId: null,
      lineUserId: 'U11111111111111111111111111111111',
      messageType: 'text',
      textContent,
      charCount: textContent.length,
      quoteToken: null,
      lineTimestamp: new Date('2026-09-04T15:00:00+08:00'),
      metadata: null,
    };
    const parsed: ParsedLineWebhook = { events: [{ kind: 'MESSAGE', message }] };
    const replies: string[] = [];

    const counters = await processWorklogGroupWebhook({
      parsed,
      bootstrap: {
        handleGroupLeave: async () => undefined,
        setGroupMemberPresence: async () => undefined,
      },
      runtime: {
        handle: async () => ({
          status: 'AI_RESPONSIBILITY_BOUND' as const,
          sourceId: 9,
          replyText: '已完成這個群組的 AI 額度負責人設定。',
        }),
      },
      reply: {
        reply: async (_token, text) => { replies.push(text); },
      },
    });

    expect(counters.worklogAiResponsibilityClaims).toBe(1);
    expect(counters.worklogRejected).toBe(0);
    expect(replies).toEqual(['已完成這個群組的 AI 額度負責人設定。']);
    expect(counters).not.toHaveProperty('worklogOwnerClaims');
  });
});
