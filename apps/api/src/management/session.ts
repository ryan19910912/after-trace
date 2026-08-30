import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import type { Database } from '../db/client';

export type UserSession = { lineUserId: string };

export type UserSessionResult =
  | { status: 'AUTHORIZED'; session: UserSession }
  | { status: 'MISSING_BEARER_TOKEN' | 'INVALID_USER_TOKEN' };

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
        | 'GROUP_NOT_FOUND'
        | 'GROUP_INACTIVE'
        | 'NOT_GROUP_MEMBER'
        | 'LINE_VERIFICATION_UNAVAILABLE';
    };

type GroupRow = { id: string; status: 'ACTIVE' | 'INACTIVE' };
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
  if (!normalized || normalized.length > 64) throw new Error(`${name} must contain 1-64 characters`);
  return normalized;
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
    session: { groupId: Number(group.id), lineGroupId, lineUserId: input.lineUserId },
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

  async verify(authorizationHeader: string | undefined, lineGroupIdInput: string): Promise<GroupSessionResult> {
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
