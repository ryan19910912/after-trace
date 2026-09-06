type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export type LineMessagingSendResult = {
  sentMessageIds: string[];
};

export class LineMessagingReplyClient {
  private readonly channelAccessToken: string;

  constructor(channelAccessToken: string, private readonly fetchImpl: FetchLike = defaultFetch) {
    const token = channelAccessToken.trim();
    if (!token) throw new Error('LINE channel access token must not be empty');
    this.channelAccessToken = token;
  }

  async reply(replyToken: string, message: string): Promise<LineMessagingSendResult> {
    const token = normalizedReplyToken(replyToken);
    const text = normalizedMessage(message);
    return this.sendReply(token, { type: 'text', text });
  }

  /**
   * Sends a real LINE mention with textV2. The message must contain exactly the
   * `{responsible}` placeholder; LINE renders the mentioned member's current display name.
   */
  async replyUserMention(
    replyToken: string,
    message: string,
    lineUserId: string,
  ): Promise<LineMessagingSendResult> {
    const token = normalizedReplyToken(replyToken);
    const text = normalizedMessage(message);
    if (!text.includes('{responsible}')) {
      throw new Error('LINE mention message must contain {responsible}');
    }
    const userId = normalizedLineUserId(lineUserId);
    return this.sendReply(token, {
      type: 'textV2',
      text,
      substitution: {
        responsible: {
          type: 'mention',
          mentionee: {
            type: 'user',
            userId,
          },
        },
      },
    });
  }

  async push(to: string, message: string): Promise<void> {
    const target = to.trim();
    if (!target) throw new Error('LINE push target must not be empty');
    const text = normalizedMessage(message);

    const response = await this.fetchImpl('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        to: target,
        messages: [{ type: 'text', text }],
      }),
    });

    if (!response.ok) {
      throw new Error(`LINE_PUSH_HTTP_${response.status}`);
    }
  }

  private async sendReply(
    replyToken: string,
    message: Record<string, unknown>,
  ): Promise<LineMessagingSendResult> {
    const response = await this.fetchImpl('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        replyToken,
        messages: [message],
      }),
    });

    if (!response.ok) {
      throw new Error(`LINE_REPLY_HTTP_${response.status}`);
    }

    // LINE message IDs can exceed JavaScript's safe-integer range. Read the successful
    // response as text and extract the sentMessages IDs without first coercing JSON
    // numeric tokens through Number. A successful reply remains successful even if LINE
    // returns an unexpected response shape; in that case deterministic bot-Reply mapping
    // is simply unavailable for this acknowledgement.
    return { sentMessageIds: sentMessageIdsFromBody(await response.text()) };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.channelAccessToken}`,
      'Content-Type': 'application/json',
    };
  }
}

export function sentMessageIdsFromBody(body: string): string[] {
  const value = body.trim();
  if (!value) return [];

  const sentMessagesMatch = value.match(/\"sentMessages\"\s*:\s*\[([\s\S]*?)\]/);
  if (!sentMessagesMatch) return [];

  const ids: string[] = [];
  const idPattern = /\"id\"\s*:\s*(?:\"([0-9]{1,64})\"|([0-9]{1,64}))/g;
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(sentMessagesMatch[1])) !== null) {
    const id = match[1] ?? match[2];
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= 5) break;
  }
  return ids;
}

function normalizedReplyToken(value: string): string {
  const token = value.trim();
  if (!token) throw new Error('LINE reply token must not be empty');
  return token;
}

function normalizedLineUserId(value: string): string {
  const userId = value.trim();
  if (!userId) throw new Error('LINE mention user id must not be empty');
  if (userId.length > 64) throw new Error('LINE mention user id is too long');
  return userId;
}

function normalizedMessage(message: string): string {
  const text = message.trim();
  if (!text) throw new Error('LINE message must not be empty');
  return text;
}
