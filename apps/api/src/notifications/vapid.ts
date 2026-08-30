import type { Bindings } from '../env';
import { base64UrlToBytes } from './validation';

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type WebPushSendResult =
  | { status: 'ACCEPTED'; httpStatus: number }
  | { status: 'SUBSCRIPTION_GONE'; httpStatus: number }
  | { status: 'RETRYABLE'; httpStatus: number | null; errorCode: string }
  | { status: 'REJECTED'; httpStatus: number; errorCode: string };

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function isValidSubject(subject: string): boolean {
  if (subject.startsWith('mailto:')) return subject.length > 'mailto:'.length;
  try {
    return new URL(subject).protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveVapidConfig(env: Bindings): VapidConfig | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;

  const publicBytes = base64UrlToBytes(publicKey);
  const privateBytes = base64UrlToBytes(privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) throw new Error('INVALID_VAPID_PUBLIC_KEY');
  if (privateBytes.length !== 32) throw new Error('INVALID_VAPID_PRIVATE_KEY');
  if (!isValidSubject(subject)) throw new Error('INVALID_VAPID_SUBJECT');
  return { publicKey: publicKey.replace(/=+$/, ''), privateKey: privateKey.replace(/=+$/, ''), subject };
}

export async function createVapidAuthorization(
  endpoint: string,
  config: VapidConfig,
  now = new Date(),
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const publicBytes = base64UrlToBytes(config.publicKey);
  const privateBytes = base64UrlToBytes(config.privateKey);
  const x = bytesToBase64Url(publicBytes.slice(1, 33));
  const y = bytesToBase64Url(publicBytes.slice(33, 65));
  const d = bytesToBase64Url(privateBytes);

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const header = textToBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = textToBase64Url(JSON.stringify({
    aud: audience,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  ));

  return `vapid t=${unsigned}.${bytesToBase64Url(signature)}, k=${config.publicKey}`;
}

export async function sendEmptyWebPush(
  endpoint: string,
  config: VapidConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<WebPushSendResult> {
  let authorization: string;
  try {
    authorization = await createVapidAuthorization(endpoint, config);
  } catch {
    return { status: 'RETRYABLE', httpStatus: null, errorCode: 'VAPID_SIGNING_FAILED' };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        TTL: '300',
        Urgency: 'high',
      },
    });
  } catch {
    return { status: 'RETRYABLE', httpStatus: null, errorCode: 'PUSH_NETWORK_ERROR' };
  }

  if (response.ok) return { status: 'ACCEPTED', httpStatus: response.status };
  if (response.status === 404 || response.status === 410) {
    return { status: 'SUBSCRIPTION_GONE', httpStatus: response.status };
  }
  if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
    return { status: 'RETRYABLE', httpStatus: response.status, errorCode: `PUSH_HTTP_${response.status}` };
  }
  return { status: 'REJECTED', httpStatus: response.status, errorCode: `PUSH_HTTP_${response.status}` };
}
