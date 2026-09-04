const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ADMIN_PASSWORD_MIN_LENGTH = 16;

export type AdminAccessEnv = {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
};

export type AdminIdentity = { username: string };

type AdminSessionClaims = {
  type: 'ADMIN_SESSION';
  username: string;
  nonce: string;
  expiresAt: number;
};

export function adminAuthConfigured(env: AdminAccessEnv): boolean {
  try {
    adminConfig(env);
    return true;
  } catch {
    return false;
  }
}

export async function authenticateAdminCredentials(
  username: string,
  password: string,
  env: AdminAccessEnv,
): Promise<AdminIdentity | null> {
  const config = adminConfig(env);
  const suppliedUsername = normalizeUsername(username);
  const suppliedPassword = normalizePassword(password);
  const [usernameMatches, passwordMatches] = await Promise.all([
    constantTimeTextEquals(suppliedUsername, config.username),
    constantTimeTextEquals(suppliedPassword, config.password),
  ]);
  return usernameMatches && passwordMatches ? { username: config.username } : null;
}

export async function issueAdminSessionToken(input: {
  username: string;
  env: AdminAccessEnv;
  now?: Date;
  ttlSeconds?: number;
}): Promise<string> {
  const config = adminConfig(input.env);
  const username = normalizeUsername(input.username);
  if (!(await constantTimeTextEquals(username, config.username))) throw new Error('ADMIN_IDENTITY_INVALID');
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 12 * 60 * 60;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 24 * 60 * 60) {
    throw new Error('ADMIN_SESSION_TTL_INVALID');
  }
  const claims: AdminSessionClaims = {
    type: 'ADMIN_SESSION',
    username: config.username,
    nonce: randomNonce(),
    expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  const payload = encoder.encode(JSON.stringify(claims));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(config.sessionSecret), asArrayBuffer(payload)));
  return `${base64UrlEncode(payload)}.${base64UrlEncode(signature)}`;
}

export async function verifyAdminSessionToken(
  token: string | undefined,
  env: AdminAccessEnv,
  now = new Date(),
): Promise<AdminIdentity | null> {
  if (!token?.trim()) return null;
  const config = adminConfig(env);
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  try {
    const payload = base64UrlDecode(payloadPart);
    const signature = base64UrlDecode(signaturePart);
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(config.sessionSecret),
      asArrayBuffer(signature),
      asArrayBuffer(payload),
    );
    if (!valid) return null;
    const raw = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    if (raw.type !== 'ADMIN_SESSION' || typeof raw.username !== 'string' || typeof raw.nonce !== 'string') return null;
    if (typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt)) return null;
    if (raw.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(raw.nonce)) return null;
    const username = normalizeUsername(raw.username);
    return await constantTimeTextEquals(username, config.username) ? { username: config.username } : null;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? '';
  return token && token.length <= 8192 ? token : null;
}

function adminConfig(env: AdminAccessEnv): { username: string; password: string; sessionSecret: string } {
  return {
    username: required(env.ADMIN_USERNAME, 'ADMIN_USERNAME', 128),
    password: requiredAdminPassword(env.ADMIN_PASSWORD),
    sessionSecret: requiredSecret(env.ADMIN_SESSION_SECRET),
  };
}

function normalizeUsername(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error('ADMIN_USERNAME_INVALID');
  return normalized;
}

function normalizePassword(value: string): string {
  if (!value || value.length > 512) throw new Error('ADMIN_PASSWORD_INVALID');
  return value;
}

function required(value: string | undefined, field: string, max: number): string {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.length > max) throw new Error(`${field}_NOT_CONFIGURED`);
  return normalized;
}

function requiredAdminPassword(value: string | undefined): string {
  const normalized = value ?? '';
  if (normalized.length < ADMIN_PASSWORD_MIN_LENGTH || normalized.length > 512) {
    throw new Error('ADMIN_PASSWORD_NOT_CONFIGURED');
  }
  return normalized;
}

function requiredSecret(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length < 32 || normalized.length > 512) throw new Error('ADMIN_SESSION_SECRET_NOT_CONFIGURED');
  return normalized;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    asArrayBuffer(encoder.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function constantTimeTextEquals(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  return mismatch === 0;
}

function randomNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

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
