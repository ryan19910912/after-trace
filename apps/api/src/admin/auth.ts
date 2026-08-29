export type AdminAccessEnv = {
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
  ADMIN_ALLOWED_EMAIL?: string;
};

export type AdminIdentity = { email: string };

type JwtHeader = { alg?: unknown; kid?: unknown };
type JwtPayload = {
  aud?: unknown;
  email?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iss?: unknown;
};
type AccessJwk = JsonWebKey & { kid?: string };
type AccessCerts = { keys?: AccessJwk[] };

const encoder = new TextEncoder();
const keyCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>();
const CERT_CACHE_MS = 10 * 60 * 1000;

export async function verifyAdminAccess(
  assertion: string | undefined,
  env: AdminAccessEnv,
  now = new Date(),
): Promise<AdminIdentity | null> {
  const teamDomain = normalizeTeamDomain(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN);
  const expectedAud = required(env.CLOUDFLARE_ACCESS_AUD, 'CLOUDFLARE_ACCESS_AUD', 256);
  const allowedEmail = required(env.ADMIN_ALLOWED_EMAIL, 'ADMIN_ALLOWED_EMAIL', 320).toLowerCase();
  if (!assertion?.trim()) return null;

  const parts = assertion.trim().split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(decodeBase64UrlText(encodedHeader)) as JwtHeader;
    payload = JSON.parse(decodeBase64UrlText(encodedPayload)) as JwtPayload;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + 30) return null;
  if (!audienceMatches(payload.aud, expectedAud)) return null;
  if (typeof payload.email !== 'string' || payload.email.trim().toLowerCase() !== allowedEmail) return null;

  const expectedIssuer = `https://${teamDomain}`;
  if (payload.iss !== expectedIssuer && payload.iss !== `${expectedIssuer}/`) return null;

  const keys = await accessKeys(teamDomain, now.getTime());
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return null;
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }
  let signature: Uint8Array;
  try {
    signature = decodeBase64UrlBytes(encodedSignature);
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  return valid ? { email: allowedEmail } : null;
}

async function accessKeys(teamDomain: string, nowMs: number): Promise<AccessJwk[]> {
  const cached = keyCache.get(teamDomain);
  if (cached && cached.expiresAt > nowMs) return cached.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`CLOUDFLARE_ACCESS_CERTS_HTTP_${response.status}`);
  const body = await response.json() as AccessCerts;
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('Cloudflare Access cert response contained no keys');
  }
  keyCache.set(teamDomain, { expiresAt: nowMs + CERT_CACHE_MS, keys: body.keys });
  return body.keys;
}

function audienceMatches(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function normalizeTeamDomain(value: string | undefined): string {
  const raw = required(value, 'CLOUDFLARE_ACCESS_TEAM_DOMAIN', 253)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(raw)) {
    throw new Error('CLOUDFLARE_ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com hostname');
  }
  return raw;
}

function required(value: string | undefined, field: string, maxLength: number): string {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function decodeBase64UrlText(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
