const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

async function key(secret: string): Promise<CryptoKey> {
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

export async function issueLineLoginState(secret: string, now = new Date(), ttlSeconds = 600): Promise<string> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(24));
  const payload = encoder.encode(JSON.stringify({
    type: 'LINE_LOGIN_STATE',
    nonce: base64UrlEncode(nonceBytes),
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
  }));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), asArrayBuffer(payload)));
  return `${base64UrlEncode(payload)}.${base64UrlEncode(signature)}`;
}

export async function verifyLineLoginState(token: string, secret: string, now = new Date()): Promise<boolean> {
  const [payloadPart, signaturePart, extra] = token.trim().split('.');
  if (!payloadPart || !signaturePart || extra) return false;
  try {
    const payload = base64UrlDecode(payloadPart);
    const signature = base64UrlDecode(signaturePart);
    const valid = await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      asArrayBuffer(signature),
      asArrayBuffer(payload),
    );
    if (!valid) return false;
    const parsed = JSON.parse(decoder.decode(payload)) as { type?: unknown; nonce?: unknown; exp?: unknown };
    return parsed.type === 'LINE_LOGIN_STATE'
      && typeof parsed.nonce === 'string'
      && /^[A-Za-z0-9_-]{16,128}$/.test(parsed.nonce)
      && typeof parsed.exp === 'number'
      && Number.isSafeInteger(parsed.exp)
      && parsed.exp > Math.floor(now.getTime() / 1000);
  } catch {
    return false;
  }
}
