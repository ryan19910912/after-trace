type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export type LineGroupSummaryResult =
  | { status: 'OK'; groupId: string; groupName: string; pictureUrl: string | null }
  | { status: 'NOT_FOUND' };

export class LineGroupSummaryClient {
  private readonly channelAccessToken: string;

  constructor(channelAccessToken: string, private readonly fetchImpl: FetchLike = defaultFetch) {
    const token = channelAccessToken.trim();
    if (!token) throw new Error('LINE channel access token must not be empty');
    this.channelAccessToken = token;
  }

  async getGroupSummary(lineGroupId: string): Promise<LineGroupSummaryResult> {
    const groupId = lineGroupId.trim();
    if (!groupId) throw new Error('LINE group id must not be empty');

    const response = await this.fetchImpl(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      },
    );

    if (response.status === 404) return { status: 'NOT_FOUND' };
    if (!response.ok) throw new Error(`LINE_GROUP_SUMMARY_HTTP_${response.status}`);

    const body = await response.json() as unknown;
    if (!isRecord(body)) throw new Error('LINE_GROUP_SUMMARY_INVALID_RESPONSE');
    const returnedGroupId = asNonEmptyString(body.groupId);
    const groupName = asNonEmptyString(body.groupName);
    const pictureUrl = optionalString(body.pictureUrl);
    if (!returnedGroupId || !groupName || returnedGroupId !== groupId) {
      throw new Error('LINE_GROUP_SUMMARY_INVALID_RESPONSE');
    }

    return { status: 'OK', groupId: returnedGroupId, groupName, pictureUrl };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return asNonEmptyString(value);
}
