const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type WebEntryClaims = {
  type: 'WEB_ENTRY';
  lineUserId: string;
  lineGroupId: string;
  nonce: string;
  expiresAt: number;
};

export type PrivateWebEntryClaims = {
  type: 'PRIVATE_WEB_ENTRY';
  lineUserId: string;
  userId: number;
  sourceId: number;
  nonce: string;
  expiresAt: number;
};

export type WebSessionClaims = {
  type: 'WEB_SESSION';
  userId: number | null;
  /** Migration-only compatibility field. Empty string means no legacy LINE identity. */
  lineUserId: string;
  expiresAt: number;
};

type TokenClaims = WebEntryClaims | PrivateWebEntryClaims | WebSessionClaims;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  const normalized = secret.trim();
  if (normalized.length < 32) throw new Error('WEB_AUTH_SECRET must contain at least 32 characters');
  return crypto.subtle.importKey(
    'raw',
    asArrayBuffer(encoder.encode(normalized)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function lineUserId(value: string): string {
  const normalized = value.trim();
  if (!/^U[0-9a-f]{32}$/i.test(normalized)) throw new Error('invalid LINE user id');
  return normalized;
}

function lineGroupId(value: string): string {
  const normalized = value.trim();
  if (!/^C[0-9a-f]{32}$/i.test(normalized)) throw new Error('invalid LINE group id');
  return normalized;
}

function nonce(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) throw new Error('invalid auth nonce');
  return normalized;
}

function positiveDatabaseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('invalid database id');
  return value;
}

async function issue(claims: TokenClaims, secret: string): Promise<string> {
  const payload = encoder.encode(JSON.stringify(claims));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await signingKey(secret), asArrayBuffer(payload)),
  );
  return `${base64UrlEncode(payload)}.${base64UrlEncode(signature)}`;
}

async function verify(token: string, secret: string, now: Date): Promise<TokenClaims | null> {
  const [payloadPart, signaturePart, extra] = token.trim().split('.');
  if (!payloadPart || !signaturePart || extra) return null;
  try {
    const payload = base64UrlDecode(payloadPart);
    const signature = base64UrlDecode(signaturePart);
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      asArrayBuffer(signature),
      asArrayBuffer(payload),
    );
    if (!valid) return null;
    const parsed = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    if (typeof parsed.type !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (!Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Math.floor(now.getTime() / 1000)) return null;

    if (parsed.type === 'WEB_SESSION') {
      const sessionUserId = parsed.userId == null ? null : positiveDatabaseId(parsed.userId);
      const legacyLineUserId = typeof parsed.lineUserId === 'string' && parsed.lineUserId.trim()
        ? lineUserId(parsed.lineUserId)
        : '';
      if (!sessionUserId && !legacyLineUserId) return null;
      return {
        type: 'WEB_SESSION',
        userId: sessionUserId,
        lineUserId: legacyLineUserId,
        expiresAt: parsed.expiresAt,
      };
    }

    if (typeof parsed.lineUserId !== 'string') return null;
    const legacyUserId = lineUserId(parsed.lineUserId);
    if (typeof parsed.nonce !== 'string') return null;
    if (parsed.type === 'PRIVATE_WEB_ENTRY') {
      return {
        type: 'PRIVATE_WEB_ENTRY',
        lineUserId: legacyUserId,
        userId: positiveDatabaseId(parsed.userId),
        sourceId: positiveDatabaseId(parsed.sourceId),
        nonce: nonce(parsed.nonce),
        expiresAt: parsed.expiresAt,
      };
    }
    if (parsed.type !== 'WEB_ENTRY' || typeof parsed.lineGroupId !== 'string') return null;
    return {
      type: 'WEB_ENTRY',
      lineUserId: legacyUserId,
      lineGroupId: lineGroupId(parsed.lineGroupId),
      nonce: nonce(parsed.nonce),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function issueWebEntryToken(input: {
  lineUserId: string;
  lineGroupId: string;
  nonce: string;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 900) throw new Error('invalid web entry ttl');
  return issue({
    type: 'WEB_ENTRY',
    lineUserId: lineUserId(input.lineUserId),
    lineGroupId: lineGroupId(input.lineGroupId),
    nonce: nonce(input.nonce),
    expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
  }, input.secret);
}

export async function verifyWebEntryToken(token: string, secret: string, now = new Date()): Promise<WebEntryClaims | null> {
  const claims = await verify(token, secret, now);
  return claims?.type === 'WEB_ENTRY' ? claims : null;
}

export async function issuePrivateWebEntryToken(input: {
  lineUserId: string;
  userId: number;
  sourceId: number;
  nonce: string;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 900) throw new Error('invalid private web entry ttl');
  return issue({
    type: 'PRIVATE_WEB_ENTRY',
    lineUserId: lineUserId(input.lineUserId),
    userId: positiveDatabaseId(input.userId),
    sourceId: positiveDatabaseId(input.sourceId),
    nonce: nonce(input.nonce),
    expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
  }, input.secret);
}

export async function verifyPrivateWebEntryToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<PrivateWebEntryClaims | null> {
  const claims = await verify(token, secret, now);
  return claims?.type === 'PRIVATE_WEB_ENTRY' ? claims : null;
}

export async function issueWebSessionToken(input: {
  userId?: number | null;
  lineUserId?: string | null;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 60 * 60 * 24 * 30;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 60 * 60 * 24 * 90) {
    throw new Error('invalid web session ttl');
  }
  const sessionUserId = input.userId == null ? null : positiveDatabaseId(input.userId);
  const legacyLineUserId = input.lineUserId == null ? '' : lineUserId(input.lineUserId);
  if (!sessionUserId && !legacyLineUserId) throw new Error('web session requires user identity');
  return issue({
    type: 'WEB_SESSION',
    userId: sessionUserId,
    lineUserId: legacyLineUserId,
    expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
  }, input.secret);
}

export async function verifyWebSessionToken(token: string, secret: string, now = new Date()): Promise<WebSessionClaims | null> {
  const claims = await verify(token, secret, now);
  return claims?.type === 'WEB_SESSION' ? claims : null;
}

export function createAuthNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return base64UrlEncode(bytes);
}
