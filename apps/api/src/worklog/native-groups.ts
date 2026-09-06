export type NativeGroupRole = 'OWNER' | 'MEMBER';

export type NativeGroupSummary = {
  sourceId: number;
  name: string;
  role: NativeGroupRole;
};

export type NativeGroupInviteSummary = {
  id: number;
  sourceId: number;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
};

export type NativeGroupCreateResult =
  | { status: 'CREATED'; group: NativeGroupSummary }
  | { status: 'USER_NOT_READY' };

export type NativeGroupInviteCreateResult =
  | { status: 'CREATED'; invite: NativeGroupInviteSummary }
  | { status: 'FORBIDDEN_OR_UNAVAILABLE' }
  | { status: 'TOKEN_CONFLICT' };

export type NativeGroupInviteRevokeResult =
  | { status: 'REVOKED'; inviteId: number }
  | { status: 'FORBIDDEN_OR_NOT_FOUND' };

export type NativeGroupJoinResult =
  | { status: 'JOINED' | 'ALREADY_MEMBER'; group: NativeGroupSummary }
  | { status: 'INVALID_INVITE' };

export interface NativeGroupRepository {
  createGroup(input: {
    creatorUserId: number;
    name: string;
  }): Promise<NativeGroupCreateResult>;

  createInvite(input: {
    sourceId: number;
    actorUserId: number;
    tokenHash: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }): Promise<NativeGroupInviteCreateResult>;

  revokeInvite(input: {
    sourceId: number;
    inviteId: number;
    actorUserId: number;
  }): Promise<NativeGroupInviteRevokeResult>;

  joinWithInvite(input: {
    actorUserId: number;
    tokenHash: string;
  }): Promise<NativeGroupJoinResult>;
}

export interface NativeGroupInviteTokenCodec {
  issue(): Promise<{ token: string; tokenHash: string }>;
  hash(token: string): Promise<string>;
}

export class WebCryptoNativeGroupInviteTokenCodec implements NativeGroupInviteTokenCodec {
  async issue(): Promise<{ token: string; tokenHash: string }> {
    const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    return { token, tokenHash: await sha256Hex(token) };
  }

  async hash(token: string): Promise<string> {
    return sha256Hex(requiredInviteToken(token));
  }
}

/**
 * Target AFTERTRACE-native GROUP service.
 *
 * GROUP data authorization is membership based and entirely independent from LINE,
 * subscription state, or AI entitlement. Raw invite tokens are returned to the caller
 * once and are never passed to persistence; repositories receive SHA-256 hashes only.
 */
export class NativeGroupService {
  constructor(
    private readonly repository: NativeGroupRepository,
    private readonly tokenCodec: NativeGroupInviteTokenCodec = new WebCryptoNativeGroupInviteTokenCodec(),
  ) {}

  async createGroup(input: {
    creatorUserId: number;
    name: string;
  }): Promise<NativeGroupCreateResult> {
    return this.repository.createGroup({
      creatorUserId: positiveInteger(input.creatorUserId, 'creator user id'),
      name: requiredName(input.name),
    });
  }

  async createInvite(input: {
    sourceId: number;
    actorUserId: number;
    expiresAt?: Date | null;
    maxUses?: number | null;
    now?: Date;
  }): Promise<
    | { status: 'CREATED'; token: string; invite: NativeGroupInviteSummary }
    | { status: 'FORBIDDEN_OR_UNAVAILABLE' | 'TOKEN_CONFLICT' }
  > {
    const now = input.now ?? new Date();
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime())) {
      throw new Error('invite expiry must be in the future');
    }
    const maxUses = input.maxUses == null ? null : positiveInteger(input.maxUses, 'invite max uses');
    const issued = await this.tokenCodec.issue();
    const token = requiredInviteToken(issued.token);
    const tokenHash = requiredTokenHash(issued.tokenHash);
    const result = await this.repository.createInvite({
      sourceId: positiveInteger(input.sourceId, 'source id'),
      actorUserId: positiveInteger(input.actorUserId, 'actor user id'),
      tokenHash,
      expiresAt,
      maxUses,
    });
    return result.status === 'CREATED'
      ? { status: 'CREATED', token, invite: result.invite }
      : result;
  }

  async revokeInvite(input: {
    sourceId: number;
    inviteId: number;
    actorUserId: number;
  }): Promise<NativeGroupInviteRevokeResult> {
    return this.repository.revokeInvite({
      sourceId: positiveInteger(input.sourceId, 'source id'),
      inviteId: positiveInteger(input.inviteId, 'invite id'),
      actorUserId: positiveInteger(input.actorUserId, 'actor user id'),
    });
  }

  async join(input: {
    actorUserId: number;
    token: string;
  }): Promise<NativeGroupJoinResult> {
    return this.repository.joinWithInvite({
      actorUserId: positiveInteger(input.actorUserId, 'actor user id'),
      tokenHash: requiredTokenHash(await this.tokenCodec.hash(requiredInviteToken(input.token))),
    });
  }
}

function requiredName(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('group name is required');
  if (normalized.length > 255) throw new Error('group name is too long');
  return normalized;
}

function requiredInviteToken(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('invite token is required');
  if (normalized.length > 256) throw new Error('invite token is too long');
  return normalized;
}

function requiredTokenHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('invite token hash must be SHA-256 hex');
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
