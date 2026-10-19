const encoder = new TextEncoder();
const decoder = new TextDecoder();
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_CLIENT_SECRET_MAX_TTL_SECONDS = 15_777_000;

export class AppleLoginError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppleLoginError';
  }
}

export type AppleClientCredential = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyP8Base64: string;
};

export type AppleIdentityTokenClaims = {
  subject: string;
  emailSnapshot: string | null;
};

type AppleJwkSet = { keys?: unknown };
type AppleJwtHeader = { alg?: unknown; kid?: unknown };
type AppleJwtClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  sub?: unknown;
  nonce?: unknown;
  email?: unknown;
};

export function createAppleNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** Apple client_secret is our JWT and is signed with our Sign in with Apple P-256 key using ES256. */
export async function createAppleClientSecret(
  credential: AppleClientCredential,
  now = new Date(),
  ttlSeconds = 600,
): Promise<string> {
  const clientId = requiredIdentifier(credential.clientId, 'APPLE_LOGIN_CLIENT_ID');
  const teamId = requiredIdentifier(credential.teamId, 'APPLE_LOGIN_TEAM_ID');
  const keyId = requiredIdentifier(credential.keyId, 'APPLE_LOGIN_KEY_ID');
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > APPLE_CLIENT_SECRET_MAX_TTL_SECONDS) {
    throw new AppleLoginError('APPLE_CLIENT_SECRET_CONFIG_INVALID', 'Apple client-secret TTL is invalid');
  }
  const issuedAt = Math.floor(validDate(now).getTime() / 1000);
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })));
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    iss: teamId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    aud: APPLE_ISSUER,
    sub: clientId,
  })));
  const signingInput = `${header}.${payload}`;
  const key = await importApplePrivateKey(credential.privateKeyP8Base64);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    asArrayBuffer(encoder.encode(signingInput)),
  ));
  if (signature.byteLength !== 64) {
    throw new AppleLoginError('APPLE_CLIENT_SECRET_SIGN_FAILED', 'Apple ES256 signature is not a 64-byte JOSE signature');
  }
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Apple identity tokens are Apple-signed OpenID Connect JWTs. Their signing keys are RSA
 * keys from /auth/keys and the token alg is RS256. Do not confuse this with the ES256
 * developer key used above to create our client_secret.
 */
export async function verifyAppleIdentityToken(input: {
  idToken: string;
  clientId: string;
  expectedNonce: string;
  now?: Date;
  fetchFn?: typeof fetch;
}): Promise<AppleIdentityTokenClaims> {
  const clientId = requiredIdentifier(input.clientId, 'APPLE_LOGIN_CLIENT_ID');
  const expectedNonce = requiredText(input.expectedNonce, 256, 'APPLE_LOGIN_NONCE_INVALID');
  const nowSeconds = Math.floor(validDate(input.now ?? new Date()).getTime() / 1000);
  const { headerPart, payloadPart, signaturePart, header, claims } = parseJwt(input.idToken);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token header is invalid');
  }

  const fetchFn = input.fetchFn ?? fetch;
  let response: Response;
  try {
    response = await fetchFn(APPLE_KEYS_URL, { headers: { Accept: 'application/json' } });
  } catch {
    throw new AppleLoginError('APPLE_KEYS_UNAVAILABLE', 'Apple public keys could not be fetched');
  }
  if (!response.ok) {
    throw new AppleLoginError('APPLE_KEYS_UNAVAILABLE', `Apple public keys returned HTTP ${response.status}`);
  }

  let body: AppleJwkSet;
  try {
    body = await response.json() as AppleJwkSet;
  } catch {
    throw new AppleLoginError('APPLE_KEYS_UNAVAILABLE', 'Apple public keys response was not valid JSON');
  }
  const jwk = matchingAppleJwk(body.keys, header.kid);
  if (!jwk) throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token signing key was not found');

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token public key is invalid');
  }

  const signature = base64UrlDecode(signaturePart);
  let verified = false;
  try {
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      asArrayBuffer(signature),
      asArrayBuffer(encoder.encode(`${headerPart}.${payloadPart}`)),
    );
  } catch {
    verified = false;
  }
  if (!verified) throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token signature verification failed');

  if (claims.iss !== APPLE_ISSUER || !audienceIncludes(claims.aud, clientId)) {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token issuer/audience is invalid');
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds) {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token is expired');
  }
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 300) {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token issue time is invalid');
  }
  if (claims.nonce !== expectedNonce) {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token nonce mismatch');
  }
  const subject = requiredText(claims.sub, 512, 'APPLE_ID_TOKEN_INVALID');
  const emailSnapshot = optionalSnapshot(claims.email, 320);
  return { subject, emailSnapshot };
}

function parseJwt(token: string): {
  headerPart: string;
  payloadPart: string;
  signaturePart: string;
  header: AppleJwtHeader;
  claims: AppleJwtClaims;
} {
  const [headerPart, payloadPart, signaturePart, extra] = token.trim().split('.');
  if (!headerPart || !payloadPart || !signaturePart || extra) {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token shape is invalid');
  }
  try {
    const header = JSON.parse(decoder.decode(base64UrlDecode(headerPart))) as AppleJwtHeader;
    const claims = JSON.parse(decoder.decode(base64UrlDecode(payloadPart))) as AppleJwtClaims;
    return { headerPart, payloadPart, signaturePart, header, claims };
  } catch {
    throw new AppleLoginError('APPLE_ID_TOKEN_INVALID', 'Apple identity token JSON is invalid');
  }
}

function matchingAppleJwk(value: unknown, kid: string): JsonWebKey | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const jwk = candidate as Record<string, unknown>;
    if (
      jwk.kid === kid
      && jwk.kty === 'RSA'
      && typeof jwk.n === 'string'
      && typeof jwk.e === 'string'
    ) {
      return candidate as JsonWebKey;
    }
  }
  return null;
}

function audienceIncludes(value: unknown, clientId: string): boolean {
  return value === clientId || (Array.isArray(value) && value.some((item) => item === clientId));
}

async function importApplePrivateKey(value: string): Promise<CryptoKey> {
  let pem = value.trim().replace(/\\n/g, '\n');
  if (!pem.includes('BEGIN PRIVATE KEY')) {
    try {
      pem = decoder.decode(base64StandardDecode(pem));
    } catch {
      throw new AppleLoginError('APPLE_PRIVATE_KEY_INVALID', 'Apple private key base64 is invalid');
    }
  }
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem);
  if (!match) throw new AppleLoginError('APPLE_PRIVATE_KEY_INVALID', 'Apple private key PEM is invalid');
  const der = base64StandardDecode(match[1].replace(/\s+/g, ''));
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      asArrayBuffer(der),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new AppleLoginError('APPLE_PRIVATE_KEY_INVALID', 'Apple private key cannot be imported as P-256 PKCS#8');
  }
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppleLoginError('APPLE_LOGIN_CONFIG_INVALID', `${label} is invalid`);
  }
  return normalized;
}

function requiredText(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string') throw new AppleLoginError(code, 'required text is missing');
  const normalized = sanitizeSnapshot(value, max);
  if (!normalized) throw new AppleLoginError(code, 'required text is empty');
  return normalized;
}

function optionalSnapshot(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return sanitizeSnapshot(value, max) || null;
}

function sanitizeSnapshot(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AppleLoginError('APPLE_LOGIN_TIME_INVALID', 'Apple Login time is invalid');
  }
  return new Date(value.getTime());
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return base64StandardDecode(padded);
}

function base64StandardDecode(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
