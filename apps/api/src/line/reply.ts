type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class LineMessagingReplyClient {
  private readonly channelAccessToken: string;

  constructor(channelAccessToken: string, private readonly fetchImpl: FetchLike = defaultFetch) {
    const token = channelAccessToken.trim();
    if (!token) throw new Error('LINE channel access token must not be empty');
    this.channelAccessToken = token;
  }

  async reply(replyToken: string, message: string): Promise<void> {
    const token = replyToken.trim();
    if (!token) throw new Error('LINE reply token must not be empty');
    const text = normalizedMessage(message);

    const response = await this.fetchImpl('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        replyToken: token,
        messages: [{ type: 'text', text }],
      }),
    });

    if (!response.ok) {
      throw new Error(`LINE_REPLY_HTTP_${response.status}`);
    }
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

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.channelAccessToken}`,
      'Content-Type': 'application/json',
    };
  }
}

function normalizedMessage(message: string): string {
  const text = message.trim();
  if (!text) throw new Error('LINE message must not be empty');
  return text;
}
