import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type LiffUserSession = {
  lineUserId: string;
};

export type LiffUserSessionResult =
  | { status: 'AUTHORIZED'; session: LiffUserSession }
  | {
      status:
        | 'MISSING_BEARER_TOKEN'
        | 'INVALID_USER_TOKEN'
        | 'WRONG_LIFF_CHANNEL'
        | 'LINE_VERIFICATION_UNAVAILABLE';
    };

export type LiffGroupSession = LiffUserSession & {
  groupId: number;
  lineGroupId: string;
};

export type LiffGroupSessionResult =
  | { status: 'AUTHORIZED'; session: LiffGroupSession }
  | {
      status:
        | 'MISSING_BEARER_TOKEN'
        | 'INVALID_USER_TOKEN'
        | 'WRONG_LIFF_CHANNEL'
        | 'GROUP_NOT_FOUND'
        | 'GROUP_INACTIVE'
        | 'NOT_GROUP_MEMBER'
        | 'LINE_VERIFICATION_UNAVAILABLE';
    };

type GroupRow = {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
};

type LineProfile = { userId?: unknown };
type TokenVerification = {
  client_id?: unknown;
  expires_in?: unknown;
};

const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? '';
  return token && token.length <= 4096 ? token : null;
}

function boundedLineId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) {
    throw new Error(`${name} must contain 1-64 characters`);
  }
  return normalized;
}

function providerUnavailable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function resolveVerifiedLineUser(input: {
  authorizationHeader: string | undefined;
  liffChannelId: string;
  fetcher: typeof fetch;
}): Promise<LiffUserSessionResult> {
  const token = bearerToken(input.authorizationHeader);
  if (!token) return { status: 'MISSING_BEARER_TOKEN' };

  const expectedChannelId = input.liffChannelId.trim();
  if (!expectedChannelId) throw new Error('LIFF_CHANNEL_ID is required');

  const verificationResponse = await input.fetcher(
    `${LINE_VERIFY_URL}?access_token=${encodeURIComponent(token)}`,
  );
  if (providerUnavailable(verificationResponse.status)) {
    return { status: 'LINE_VERIFICATION_UNAVAILABLE' };
  }
  if (!verificationResponse.ok) return { status: 'INVALID_USER_TOKEN' };
  const verification = (await verificationResponse.json()) as TokenVerification;
  if (verification.client_id !== expectedChannelId) return { status: 'WRONG_LIFF_CHANNEL' };
  if (typeof verification.expires_in !== 'number' || verification.expires_in <= 0) {
    return { status: 'INVALID_USER_TOKEN' };
  }

  const profileResponse = await input.fetcher(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (providerUnavailable(profileResponse.status)) {
    return { status: 'LINE_VERIFICATION_UNAVAILABLE' };
  }
  if (!profileResponse.ok) return { status: 'INVALID_USER_TOKEN' };

  const profile = (await profileResponse.json()) as LineProfile;
  if (typeof profile.userId !== 'string') return { status: 'INVALID_USER_TOKEN' };
  return {
    status: 'AUTHORIZED',
    session: { lineUserId: boundedLineId(profile.userId, 'lineUserId') },
  };
}

export class LineLiffUserSessionVerifier {
  constructor(
    private readonly liffChannelId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  verify(authorizationHeader: string | undefined): Promise<LiffUserSessionResult> {
    return resolveVerifiedLineUser({
      authorizationHeader,
      liffChannelId: this.liffChannelId,
      fetcher: this.fetcher,
    });
  }
}

/**
 * Authenticates a LIFF caller without trusting client-supplied user identity.
 * Group-scoped data additionally requires current LINE group membership.
 */
export class LineLiffGroupSessionVerifier {
  constructor(
    private readonly db: Database,
    private readonly channelAccessToken: string,
    private readonly liffChannelId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verify(
    authorizationHeader: string | undefined,
    lineGroupIdInput: string,
  ): Promise<LiffGroupSessionResult> {
    const verified = await resolveVerifiedLineUser({
      authorizationHeader,
      liffChannelId: this.liffChannelId,
      fetcher: this.fetcher,
    });
    if (verified.status !== 'AUTHORIZED') return verified;

    const lineGroupId = boundedLineId(lineGroupIdInput, 'lineGroupId');
    const groupResult = await this.db.execute(sql`
      SELECT id::text AS id, status
      FROM line_groups
      WHERE line_group_id = ${lineGroupId}
      LIMIT 1
    `);
    const group = groupResult.rows[0] as GroupRow | undefined;
    if (!group) return { status: 'GROUP_NOT_FOUND' };
    if (group.status !== 'ACTIVE') return { status: 'GROUP_INACTIVE' };

    const membershipResponse = await this.fetcher(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(lineGroupId)}/member/${encodeURIComponent(verified.session.lineUserId)}`,
      {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      },
    );
    if (membershipResponse.status === 404) return { status: 'NOT_GROUP_MEMBER' };
    if (!membershipResponse.ok) return { status: 'LINE_VERIFICATION_UNAVAILABLE' };

    return {
      status: 'AUTHORIZED',
      session: {
        groupId: Number(group.id),
        lineGroupId,
        lineUserId: verified.session.lineUserId,
      },
    };
  }
}
