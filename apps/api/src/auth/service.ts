import { createAuthNonce, issueWebEntryToken, issueWebSessionToken, verifyWebEntryToken } from './token';
import { DrizzleWebAuthRepository } from './repository';

const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

type LineMemberProfile = { userId?: unknown; displayName?: unknown };
type LineGroupSummary = { groupId?: unknown; groupName?: unknown };

export type WebGroup = {
  id: number;
  lineGroupId: string;
  name: string;
};

type ExchangeBotEntryResult =
  | { status: 'AUTHORIZED'; sessionToken: string; lineUserId: string; lineGroupId: string }
  | { status: 'INVALID_OR_EXPIRED' }
  | { status: 'ALREADY_USED' }
  | { status: 'NOT_GROUP_MEMBER' }
  | { status: 'LINE_UNAVAILABLE' };

export class WebAuthService {
  constructor(
    private readonly repository: DrizzleWebAuthRepository,
    private readonly channelAccessToken: string,
    private readonly authSecret: string,
    private readonly fetcher: typeof fetch = runtimeFetch,
  ) {}

  async createBotEntry(input: {
    webAppUrl: string;
    lineUserId: string;
    lineGroupId: string;
    at: Date;
  }): Promise<string> {
    const nonce = createAuthNonce();
    const ttlSeconds = 300;
    const token = await issueWebEntryToken({
      lineUserId: input.lineUserId,
      lineGroupId: input.lineGroupId,
      nonce,
      secret: this.authSecret,
      now: input.at,
      ttlSeconds,
    });
    const registered = await this.repository.registerEntry({
      nonce,
      lineUserId: input.lineUserId,
      lineGroupId: input.lineGroupId,
      expiresAt: new Date(input.at.getTime() + ttlSeconds * 1000),
    });
    if (!registered) throw new Error('failed to register web auth entry');
    const url = new URL(input.webAppUrl);
    url.searchParams.set('t', token);
    url.searchParams.set('openExternalBrowser', '1');
    return url.toString();
  }

  async exchangeBotEntry(token: string, at = new Date()): Promise<ExchangeBotEntryResult> {
    const claims = await verifyWebEntryToken(token, this.authSecret, at);
    if (!claims) return { status: 'INVALID_OR_EXPIRED' };

    const member = await this.fetcher(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(claims.lineGroupId)}/member/${encodeURIComponent(claims.lineUserId)}`,
      { headers: { Authorization: `Bearer ${this.channelAccessToken}` } },
    );
    if (member.status === 404) return { status: 'NOT_GROUP_MEMBER' };
    if (!member.ok) return { status: 'LINE_UNAVAILABLE' };
    const profile = (await member.json()) as LineMemberProfile;
    if (profile.userId !== claims.lineUserId) return { status: 'NOT_GROUP_MEMBER' };

    const consumed = await this.repository.consumeEntry({
      nonce: claims.nonce,
      lineUserId: claims.lineUserId,
      lineGroupId: claims.lineGroupId,
      at,
    });
    if (!consumed) return { status: 'ALREADY_USED' };

    return {
      status: 'AUTHORIZED',
      sessionToken: await issueWebSessionToken({
        lineUserId: claims.lineUserId,
        secret: this.authSecret,
        now: at,
      }),
      lineUserId: claims.lineUserId,
      lineGroupId: claims.lineGroupId,
    };
  }

  async listGroups(lineUserId: string): Promise<WebGroup[]> {
    const groups = await this.repository.listActiveGroups(lineUserId);
    const visible: WebGroup[] = [];
    for (const group of groups) {
      const summaryResponse = await this.fetcher(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(group.lineGroupId)}/summary`,
        { headers: { Authorization: `Bearer ${this.channelAccessToken}` } },
      );
      if (summaryResponse.status === 404) continue;
      if (!summaryResponse.ok) throw new Error('LINE_GROUP_SUMMARY_UNAVAILABLE');
      const summary = (await summaryResponse.json()) as LineGroupSummary;
      if (summary.groupId !== group.lineGroupId) continue;
      visible.push({
        id: group.id,
        lineGroupId: group.lineGroupId,
        name: typeof summary.groupName === 'string' && summary.groupName.trim()
          ? summary.groupName.trim()
          : 'LINE 群組',
      });
    }
    return visible;
  }
}
