type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export type LineUserProfile = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
};

export class LineUserProfileClient {
  private readonly channelAccessToken: string;

  constructor(channelAccessToken: string, private readonly fetchImpl: FetchLike = defaultFetch) {
    const token = channelAccessToken.trim();
    if (!token) throw new Error('LINE channel access token must not be empty');
    this.channelAccessToken = token;
  }

  async getUserProfile(lineUserId: string): Promise<LineUserProfile | null> {
    const userId = normalizeId(lineUserId, 'LINE user id');
    return this.fetchProfile(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, userId);
  }

  async getGroupMemberProfile(lineGroupId: string, lineUserId: string): Promise<LineUserProfile | null> {
    const groupId = normalizeId(lineGroupId, 'LINE group id');
    const userId = normalizeId(lineUserId, 'LINE user id');
    return this.fetchProfile(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
      userId,
    );
  }

  private async fetchProfile(url: string, expectedUserId: string): Promise<LineUserProfile | null> {
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.channelAccessToken}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LINE_USER_PROFILE_HTTP_${response.status}`);

    const body = await response.json() as unknown;
    if (!isRecord(body)) throw new Error('LINE_USER_PROFILE_INVALID_RESPONSE');
    const userId = asNonEmptyString(body.userId);
    const displayName = asNonEmptyString(body.displayName);
    const pictureUrl = optionalString(body.pictureUrl);
    if (!userId || !displayName || userId !== expectedUserId) throw new Error('LINE_USER_PROFILE_INVALID_RESPONSE');
    return { userId, displayName, pictureUrl };
  }
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  return normalized;
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
