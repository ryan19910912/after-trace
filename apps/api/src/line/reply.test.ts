import { describe, expect, it } from 'vitest';
import { LineMessagingReplyClient, sentMessageIdsFromBody } from './reply';

describe('sentMessageIdsFromBody', () => {
  it('preserves numeric LINE message IDs beyond JavaScript safe integer precision', () => {
    expect(sentMessageIdsFromBody('{"sentMessages":[{"id":468789577898262530,"quoteToken":"q"}]}'))
      .toEqual(['468789577898262530']);
  });

  it('accepts string IDs and ignores unrelated id fields outside sentMessages', () => {
    expect(sentMessageIdsFromBody('{"request":{"id":"999"},"sentMessages":[{"id":"123456789012345678"}]}'))
      .toEqual(['123456789012345678']);
  });

  it('returns an empty mapping for a successful but unexpected response shape', () => {
    expect(sentMessageIdsFromBody('{}')).toEqual([]);
    expect(sentMessageIdsFromBody('')).toEqual([]);
  });
});

describe('LineMessagingReplyClient textV2 mention', () => {
  it('sends a real user mention without exposing the raw user id in message text', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('{"sentMessages":[{"id":"123456789012345678"}]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new LineMessagingReplyClient('test-token', fetchImpl);

    await expect(client.replyUserMention(
      'reply-token',
      '已完成這個群組的 AI 額度負責人設定。\n\nAI 額度負責人：{responsible}',
      'U11111111111111111111111111111111',
    )).resolves.toEqual({ sentMessageIds: ['123456789012345678'] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.line.me/v2/bot/message/reply');
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      replyToken: string;
      messages: Array<Record<string, unknown>>;
    };
    expect(body.replyToken).toBe('reply-token');
    expect(body.messages[0]).toEqual({
      type: 'textV2',
      text: '已完成這個群組的 AI 額度負責人設定。\n\nAI 額度負責人：{responsible}',
      substitution: {
        responsible: {
          type: 'mention',
          mentionee: {
            type: 'user',
            userId: 'U11111111111111111111111111111111',
          },
        },
      },
    });
    expect(JSON.stringify(body.messages[0])).toContain('U11111111111111111111111111111111');
    expect((body.messages[0]?.text as string)).not.toContain('U11111111111111111111111111111111');
  });

  it('requires the responsible placeholder for mention replies', async () => {
    const client = new LineMessagingReplyClient('test-token', async () => new Response('{}', { status: 200 }));
    await expect(client.replyUserMention('reply-token', '沒有 mention placeholder', 'U111'))
      .rejects.toThrow('LINE mention message must contain {responsible}');
  });
});
