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
    const text = message.trim();
    if (!text) throw new Error('LINE reply message must not be empty');

    const response = await this.fetchImpl('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken: token,
        messages: [{ type: 'text', text }],
      }),
    });

    if (!response.ok) {
      throw new Error(`LINE_REPLY_HTTP_${response.status}`);
    }
  }
}
