import {
  createAuthNonce,
  issuePrivateWebEntryToken,
  issueWebEntryToken,
  issueWebSessionToken,
  verifyPrivateWebEntryToken,
  verifyWebEntryToken,
} from './token';
import { DrizzleWebAuthRepository } from './repository';

const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

type LineMemberProfile = { userId?: unknown; displayName?: unknown };
type LineGroupSummary = { groupId?: unknown; groupName?: unknown };

export type WebGroup = {
  id: number;
  lineGroupId: string;
  name: string;
};

export type WebGroupMemory = {
  id: number;
  groupId: number;
  lineGroupId: string;
  groupName: string;
  category: string;
  subject: string | null;
  content: string;
  sourceMessageId: string | null;
  sourceLineTimestamp: string | null;
  updatedAt: string;
};

export type ExchangeBotEntryResult =
  | {
      status: 'AUTHORIZED';
      sessionToken: string;
      lineUserId: string;
      entryContext: { type: 'GROUP'; lineGroupId: string } | { type: 'PRIVATE'; userId: number; sourceId: number };
    }
  | { status: 'INVALID_OR_EXPIRED' }
  | { status: 'ALREADY_USED' }
  | { status: 'NOT_GROUP_MEMBER' }
  | { status: 'PRIVATE_ACCESS_REVOKED' }
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
  }): Promise<string | null> {
    try {
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
      if (!registered) {
        console.error(JSON.stringify({
          event: 'web_auth_entry_register_failed',
          lineGroupId: input.lineGroupId,
          lineUserId: input.lineUserId,
        }));
        return null;
      }
      const url = new URL(input.webAppUrl);
      url.searchParams.set('t', token);
      url.searchParams.set('openExternalBrowser', '1');
      return url.toString();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'web_auth_entry_create_failed',
        lineGroupId: input.lineGroupId,
        lineUserId: input.lineUserId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
      return null;
    }
  }

  async createPrivateBotEntry(input: {
    webAppUrl: string;
    lineUserId: string;
    userId: number;
    sourceId: number;
    at: Date;
  }): Promise<string | null> {
    try {
      const nonce = createAuthNonce();
      const ttlSeconds = 300;
      const token = await issuePrivateWebEntryToken({
        lineUserId: input.lineUserId,
        userId: input.userId,
        sourceId: input.sourceId,
        nonce,
        secret: this.authSecret,
        now: input.at,
        ttlSeconds,
      });
      const registered = await this.repository.registerPrivateEntry({
        nonce,
        lineUserId: input.lineUserId,
        userId: input.userId,
        sourceId: input.sourceId,
        expiresAt: new Date(input.at.getTime() + ttlSeconds * 1000),
      });
      if (!registered) {
        console.error(JSON.stringify({
          event: 'private_web_auth_entry_register_failed',
          lineUserId: input.lineUserId,
          userId: input.userId,
          sourceId: input.sourceId,
        }));
        return null;
      }
      const url = new URL(input.webAppUrl);
      url.searchParams.set('t', token);
      url.searchParams.set('openExternalBrowser', '1');
      return url.toString();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'private_web_auth_entry_create_failed',
        lineUserId: input.lineUserId,
        userId: input.userId,
        sourceId: input.sourceId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
      return null;
    }
  }

  async exchangeBotEntry(token: string, at = new Date()): Promise<ExchangeBotEntryResult> {
    const privateClaims = await verifyPrivateWebEntryToken(token, this.authSecret, at);
    if (privateClaims) {
      const consumed = await this.repository.consumePrivateEntry({
        nonce: privateClaims.nonce,
        lineUserId: privateClaims.lineUserId,
        userId: privateClaims.userId,
        sourceId: privateClaims.sourceId,
        at,
      });
      if (consumed === 'ALREADY_USED') return { status: 'ALREADY_USED' };
      if (consumed === 'ACCESS_REVOKED') return { status: 'PRIVATE_ACCESS_REVOKED' };
      if (consumed !== 'CONSUMED') return { status: 'INVALID_OR_EXPIRED' };
      return {
        status: 'AUTHORIZED',
        sessionToken: await issueWebSessionToken({
          lineUserId: privateClaims.lineUserId,
          secret: this.authSecret,
          now: at,
        }),
        lineUserId: privateClaims.lineUserId,
        entryContext: {
          type: 'PRIVATE',
          userId: privateClaims.userId,
          sourceId: privateClaims.sourceId,
        },
      };
    }

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
      entryContext: { type: 'GROUP', lineGroupId: claims.lineGroupId },
    };
  }

  async listGroups(lineUserId: string): Promise<WebGroup[]> {
    const groups = await this.repository.listActiveGroups(lineUserId);
    const visible: WebGroup[] = [];
    for (const group of groups) {
      const memberResponse = await this.fetcher(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(group.lineGroupId)}/member/${encodeURIComponent(lineUserId)}`,
        { headers: { Authorization: `Bearer ${this.channelAccessToken}` } },
      );
      if (memberResponse.status === 404) continue;
      if (!memberResponse.ok) throw new Error('LINE_GROUP_MEMBER_UNAVAILABLE');

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

  async searchMemories(lineUserId: string, query?: string | null): Promise<WebGroupMemory[]> {
    const normalizedQuery = query?.trim() || null;
    if (normalizedQuery && normalizedQuery.length > 200) throw new Error('QUERY_TOO_LONG');
    const groups = await this.listGroups(lineUserId);
    const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
    const rows = await this.repository.listGroupMemories(groups.map((group) => group.id), normalizedQuery, 200);
    return rows.map((memory) => ({
      ...memory,
      groupName: groupNameById.get(memory.groupId) ?? 'LINE 群組',
    }));
  }
}
