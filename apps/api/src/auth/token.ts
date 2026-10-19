const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type WebSessionClaims = {
  type: 'WEB_SESSION';
  userId: number;
  expiresAt: number;
};

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

function positiveDatabaseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('invalid database id');
  }
  return value;
}

async function issue(claims: WebSessionClaims, secret: string): Promise<string> {
  const payload = encoder.encode(JSON.stringify(claims));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await signingKey(secret), asArrayBuffer(payload)),
  );
  return `${base64UrlEncode(payload)}.${base64UrlEncode(signature)}`;
}

async function verify(token: string, secret: string, now: Date): Promise<WebSessionClaims | null> {
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
    if (parsed.type !== 'WEB_SESSION') return null;
    if (typeof parsed.expiresAt !== 'number' || !Number.isSafeInteger(parsed.expiresAt)) return null;
    if (parsed.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    return {
      type: 'WEB_SESSION',
      userId: positiveDatabaseId(parsed.userId),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function issueWebSessionToken(input: {
  userId: number;
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
    userId: positiveDatabaseId(input.userId),
    expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
  }, input.secret);
}

export async function verifyWebSessionToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<WebSessionClaims | null> {
  return verify(token, secret, now);
}
