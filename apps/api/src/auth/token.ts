const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type WebEntryClaims = {
  type: 'WEB_ENTRY';
  lineUserId: string;
  lineGroupId: string;
  nonce: string;
  expiresAt: number;
};

export type WebSessionClaims = {
  type: 'WEB_SESSION';
  lineUserId: string;
  expiresAt: number;
};

type TokenClaims = WebEntryClaims | WebSessionClaims;

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
    if (typeof parsed.type !== 'string' || typeof parsed.lineUserId !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    if (!Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    const userId = lineUserId(parsed.lineUserId);
    if (parsed.type === 'WEB_SESSION') {
      return { type: 'WEB_SESSION', lineUserId: userId, expiresAt: parsed.expiresAt };
    }
    if (parsed.type !== 'WEB_ENTRY' || typeof parsed.lineGroupId !== 'string' || typeof parsed.nonce !== 'string') return null;
    return {
      type: 'WEB_ENTRY',
      lineUserId: userId,
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

export async function issueWebSessionToken(input: {
  lineUserId: string;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 60 * 60 * 24 * 30;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 60 * 60 * 24 * 90) {
    throw new Error('invalid web session ttl');
  }
  return issue({
    type: 'WEB_SESSION',
    lineUserId: lineUserId(input.lineUserId),
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
