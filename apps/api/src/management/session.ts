import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import type { Database } from '../db/client';

export type UserSession = {
  lineUserId: string;
};

export type UserSessionResult =
  | { status: 'AUTHORIZED'; session: UserSession }
  | {
      status:
        | 'MISSING_BEARER_TOKEN'
        | 'INVALID_USER_TOKEN'
        | 'WRONG_LIFF_CHANNEL'
        | 'LINE_VERIFICATION_UNAVAILABLE';
    };

export type GroupSession = UserSession & {
  groupId: number;
  lineGroupId: string;
};

export type GroupSessionResult =
  | { status: 'AUTHORIZED'; session: GroupSession }
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

export type LiffUserSession = UserSession;
export type LiffUserSessionResult = UserSessionResult;
export type LiffGroupSession = GroupSession;
export type LiffGroupSessionResult = GroupSessionResult;

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
const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? '';
  return token && token.length <= 8192 ? token : null;
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
}): Promise<UserSessionResult> {
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

async function resolveGroupSession(input: {
  db: Database;
  channelAccessToken: string;
  lineUserId: string;
  lineGroupIdInput: string;
  fetcher: typeof fetch;
}): Promise<GroupSessionResult> {
  const lineGroupId = boundedLineId(input.lineGroupIdInput, 'lineGroupId');
  const groupResult = await input.db.execute(sql`
    SELECT id::text AS id, status
    FROM line_groups
    WHERE line_group_id = ${lineGroupId}
    LIMIT 1
  `);
  const group = groupResult.rows[0] as GroupRow | undefined;
  if (!group) return { status: 'GROUP_NOT_FOUND' };
  if (group.status !== 'ACTIVE') return { status: 'GROUP_INACTIVE' };

  const membershipResponse = await input.fetcher(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(lineGroupId)}/member/${encodeURIComponent(input.lineUserId)}`,
    { headers: { Authorization: `Bearer ${input.channelAccessToken}` } },
  );
  if (membershipResponse.status === 404) return { status: 'NOT_GROUP_MEMBER' };
  if (!membershipResponse.ok) return { status: 'LINE_VERIFICATION_UNAVAILABLE' };

  return {
    status: 'AUTHORIZED',
    session: {
      groupId: Number(group.id),
      lineGroupId,
      lineUserId: input.lineUserId,
    },
  };
}

export class LineWebUserSessionVerifier {
  constructor(private readonly webAuthSecret: string) {}

  async verify(authorizationHeader: string | undefined): Promise<UserSessionResult> {
    const token = bearerToken(authorizationHeader);
    if (!token) return { status: 'MISSING_BEARER_TOKEN' };
    const session = await verifyWebSessionToken(token, this.webAuthSecret);
    return session
      ? { status: 'AUTHORIZED', session: { lineUserId: session.lineUserId } }
      : { status: 'INVALID_USER_TOKEN' };
  }
}

export class LineWebGroupSessionVerifier {
  constructor(
    private readonly db: Database,
    private readonly channelAccessToken: string,
    private readonly webAuthSecret: string,
    private readonly fetcher: typeof fetch = runtimeFetch,
  ) {}

  async verify(
    authorizationHeader: string | undefined,
    lineGroupIdInput: string,
  ): Promise<GroupSessionResult> {
    const verified = await new LineWebUserSessionVerifier(this.webAuthSecret).verify(authorizationHeader);
    if (verified.status !== 'AUTHORIZED') return verified;
    return resolveGroupSession({
      db: this.db,
      channelAccessToken: this.channelAccessToken,
      lineUserId: verified.session.lineUserId,
      lineGroupIdInput,
      fetcher: this.fetcher,
    });
  }
}

export class LineLiffUserSessionVerifier {
  constructor(
    private readonly liffChannelId: string,
    private readonly fetcher: typeof fetch = runtimeFetch,
  ) {}

  verify(authorizationHeader: string | undefined): Promise<UserSessionResult> {
    return resolveVerifiedLineUser({
      authorizationHeader,
      liffChannelId: this.liffChannelId,
      fetcher: this.fetcher,
    });
  }
}

/** Legacy verifier retained only during the LIFF-to-Web migration. */
export class LineLiffGroupSessionVerifier {
  constructor(
    private readonly db: Database,
    private readonly channelAccessToken: string,
    private readonly liffChannelId: string,
    private readonly fetcher: typeof fetch = runtimeFetch,
  ) {}

  async verify(
    authorizationHeader: string | undefined,
    lineGroupIdInput: string,
  ): Promise<GroupSessionResult> {
    const verified = await resolveVerifiedLineUser({
      authorizationHeader,
      liffChannelId: this.liffChannelId,
      fetcher: this.fetcher,
    });
    if (verified.status !== 'AUTHORIZED') return verified;
    return resolveGroupSession({
      db: this.db,
      channelAccessToken: this.channelAccessToken,
      lineUserId: verified.session.lineUserId,
      lineGroupIdInput,
      fetcher: this.fetcher,
    });
  }
}
