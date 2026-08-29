import type { LinePushResult, ReminderLinePushClient } from '../reminders/delivery';

type FetchLike = typeof fetch;

function boundedToken(value: string): string {
  const token = value.trim();
  if (!token) throw new Error('LINE channel access token must not be empty');
  return token;
}

export class LineMessagingPushClient implements ReminderLinePushClient {
  constructor(
    channelAccessToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.channelAccessToken = boundedToken(channelAccessToken);
  }

  private readonly channelAccessToken: string;

  async push(groupId: string, message: string, retryKey: string): Promise<LinePushResult> {
    try {
      const response = await this.fetchImpl('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json',
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({
          to: groupId,
          messages: [{ type: 'text', text: message }],
        }),
      });

      // LINE documents 409 as the safe-retry response when the same retry key was
      // already accepted. For Reminder settlement that is equivalent to accepted.
      if (response.ok || response.status === 409) {
        return {
          status: 'ACCEPTED',
          deliveryReference: `line-retry:${retryKey}`,
        };
      }

      if (response.status === 429 || response.status >= 500) {
        return { status: 'RETRYABLE_FAILURE', code: `LINE_HTTP_${response.status}` };
      }

      return { status: 'PERMANENT_FAILURE', code: `LINE_HTTP_${response.status}` };
    } catch {
      // A network error is delivery-ambiguous. Retrying with the same LINE retry key is
      // specifically what prevents a duplicate accepted Push in this situation.
      return { status: 'RETRYABLE_FAILURE', code: 'LINE_NETWORK_ERROR' };
    }
  }
}
