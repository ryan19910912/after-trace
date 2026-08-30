const encoder = new TextEncoder();

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
  if (!normalized) throw new Error('LINE_CHANNEL_SECRET is required');
  return crypto.subtle.importKey(
    'raw',
    asArrayBuffer(encoder.encode(normalized)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function issueGroupContextToken(
  lineGroupId: string,
  secret: string,
  now = new Date(),
  ttlSeconds = 86_400,
): Promise<string> {
  const groupId = lineGroupId.trim();
  if (!/^C[0-9a-f]{32}$/i.test(groupId)) throw new Error('invalid LINE group id');
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = encoder.encode(JSON.stringify({ g: groupId, exp: expiresAt }));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await signingKey(secret), asArrayBuffer(payload)),
  );
  return `${base64UrlEncode(payload)}.${base64UrlEncode(signature)}`;
}

export async function verifyGroupContextToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<string | null> {
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
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as { g?: unknown; exp?: unknown };
    if (typeof parsed.g !== 'string' || !/^C[0-9a-f]{32}$/i.test(parsed.g)) return null;
    if (typeof parsed.exp !== 'number' || !Number.isSafeInteger(parsed.exp)) return null;
    if (parsed.exp <= Math.floor(now.getTime() / 1000)) return null;
    return parsed.g;
  } catch {
    return null;
  }
}

export async function buildGroupLiffUrl(
  liffAppUrl: string,
  lineGroupId: string,
  secret: string,
  now = new Date(),
): Promise<string> {
  const url = new URL(liffAppUrl);
  url.searchParams.set('gc', await issueGroupContextToken(lineGroupId, secret, now));
  return url.toString();
}
