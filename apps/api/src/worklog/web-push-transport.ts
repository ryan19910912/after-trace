export type WebPushSubscriptionTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type WebPushPayload = {
  notificationId: number;
  title: string;
  body: string;
  deepLink: string | null;
};

export type WebPushVapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type WebPushTransportResult = {
  ok: boolean;
  status: number;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const CONTENT_RECORD_SIZE = 4096;
const MAX_PAYLOAD_BYTES = 3500;
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/**
 * Cloudflare-Worker-native RFC 8291/RFC 8292 transport. It intentionally relies only on
 * Web Crypto + fetch so push delivery does not require Node-only `web-push` crypto/http APIs.
 */
export class WorkerWebPushTransport {
  private readonly config: NormalizedVapidConfig;

  constructor(config: WebPushVapidConfig, private readonly fetcher: FetchLike = fetch) {
    this.config = normalizeVapidConfig(config);
  }

  async send(subscription: WebPushSubscriptionTarget, payload: WebPushPayload): Promise<WebPushTransportResult> {
    const request = await buildWebPushRequest(this.config, subscription, payload);
    const response = await this.fetcher(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: asArrayBuffer(request.body),
    });
    return { ok: response.ok, status: response.status };
  }
}

type NormalizedVapidConfig = {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyEncoded: string;
  subject: string;
};

export type BuiltWebPushRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

export async function buildWebPushRequest(
  configInput: WebPushVapidConfig | NormalizedVapidConfig,
  subscriptionInput: WebPushSubscriptionTarget,
  payloadInput: WebPushPayload,
): Promise<BuiltWebPushRequest> {
  const config = 'publicKeyEncoded' in configInput ? configInput : normalizeVapidConfig(configInput);
  const subscription = normalizeTarget(subscriptionInput);
  const payload = normalizePayload(payloadInput);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error('PUSH_PAYLOAD_TOO_LARGE');

  const body = await encryptPayload(subscription, payloadBytes);
  const authorization = await vapidAuthorization(config, subscription.endpoint);
  return {
    endpoint: subscription.endpoint,
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'normal',
      Topic: pushTopic(payload.notificationId),
    },
    body,
  };
}

function normalizeVapidConfig(input: WebPushVapidConfig): NormalizedVapidConfig {
  const publicKeyEncoded = boundedToken(input.publicKey, 512, 'INVALID_WEB_PUSH_PUBLIC_KEY');
  const privateKeyEncoded = boundedToken(input.privateKey, 512, 'INVALID_WEB_PUSH_PRIVATE_KEY');
  const publicKey = decodeBase64Url(publicKeyEncoded, 'INVALID_WEB_PUSH_PUBLIC_KEY');
  const privateKey = decodeBase64Url(privateKeyEncoded, 'INVALID_WEB_PUSH_PRIVATE_KEY');
  if (publicKey.byteLength !== 65 || publicKey[0] !== 0x04) throw new Error('INVALID_WEB_PUSH_PUBLIC_KEY');
  if (privateKey.byteLength !== 32) throw new Error('INVALID_WEB_PUSH_PRIVATE_KEY');
  return {
    publicKey,
    privateKey,
    publicKeyEncoded,
    subject: vapidSubject(input.subject),
  };
}

function normalizeTarget(input: WebPushSubscriptionTarget): WebPushSubscriptionTarget {
  const endpoint = boundedToken(input.endpoint, 4096, 'INVALID_PUSH_ENDPOINT');
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('INVALID_PUSH_ENDPOINT');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('INVALID_PUSH_ENDPOINT');
  const p256dh = boundedToken(input.p256dh, 1024, 'INVALID_PUSH_P256DH');
  const auth = boundedToken(input.auth, 512, 'INVALID_PUSH_AUTH');
  const receiverPublicKey = decodeBase64Url(p256dh, 'INVALID_PUSH_P256DH');
  const authSecret = decodeBase64Url(auth, 'INVALID_PUSH_AUTH');
  if (receiverPublicKey.byteLength !== 65 || receiverPublicKey[0] !== 0x04) throw new Error('INVALID_PUSH_P256DH');
  if (authSecret.byteLength !== 16) throw new Error('INVALID_PUSH_AUTH');
  return { endpoint, p256dh, auth };
}

function normalizePayload(input: WebPushPayload): WebPushPayload {
  if (!Number.isSafeInteger(input.notificationId) || input.notificationId <= 0) {
    throw new Error('INVALID_NOTIFICATION_ID');
  }
  const title = boundedText(input.title, 120, 'INVALID_PUSH_TITLE');
  const body = boundedText(input.body, 1000, 'INVALID_PUSH_BODY');
  const deepLink = optionalText(input.deepLink, 2000);
  return { notificationId: input.notificationId, title, body, deepLink };
}

async function encryptPayload(
  subscription: WebPushSubscriptionTarget,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const receiverPublicBytes = decodeBase64Url(subscription.p256dh, 'INVALID_PUSH_P256DH');
  const authSecret = decodeBase64Url(subscription.auth, 'INVALID_PUSH_AUTH');
  const receiverPublic = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(receiverPublicBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const senderKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const senderPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublic },
    senderKeys.privateKey,
    256,
  ));

  const authPrk = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concat(
    new TextEncoder().encode('WebPush: info\u0000'),
    receiverPublicBytes,
    senderPublicBytes,
  );
  const ikm = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\u0000'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\u0000'), 12);
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', asArrayBuffer(cek), 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(nonce), tagLength: 128 },
    aesKey,
    asArrayBuffer(plaintext),
  ));
  if (ciphertext.byteLength > CONTENT_RECORD_SIZE) throw new Error('PUSH_PAYLOAD_TOO_LARGE');

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, CONTENT_RECORD_SIZE, false);
  return concat(
    salt,
    recordSize,
    new Uint8Array([senderPublicBytes.byteLength]),
    senderPublicBytes,
    ciphertext,
  );
}

async function vapidAuthorization(config: NormalizedVapidConfig, endpoint: string): Promise<string> {
  const endpointUrl = new URL(endpoint);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    aud: endpointUrl.origin,
    exp: nowSeconds + VAPID_TTL_SECONDS,
    sub: config.subject,
  })));
  const signingInput = `${header}.${claims}`;
  const signingKey = await importVapidPrivateKey(config);
  const rawSignature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    asArrayBuffer(new TextEncoder().encode(signingInput)),
  ));
  const signature = joseEcdsaSignature(rawSignature);
  return `vapid t=${signingInput}.${base64Url(signature)}, k=${config.publicKeyEncoded}`;
}

async function importVapidPrivateKey(config: NormalizedVapidConfig): Promise<CryptoKey> {
  const x = config.publicKey.slice(1, 33);
  const y = config.publicKey.slice(33, 65);
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64Url(x),
      y: base64Url(y),
      d: base64Url(config.privateKey),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, asArrayBuffer(data)));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(length) || length <= 0 || length > 255 * 32) throw new Error('INVALID_HKDF_LENGTH');
  const output = new Uint8Array(length);
  let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let offset = 0;
  for (let counter = 1; offset < length; counter += 1) {
    const block = await hmacSha256(prk, concat(previous, info, new Uint8Array([counter])));
    const take = Math.min(block.byteLength, length - offset);
    output.set(block.slice(0, take), offset);
    offset += take;
    previous = block;
  }
  return output;
}

function joseEcdsaSignature(signature: Uint8Array): Uint8Array {
  if (signature.byteLength === 64) return signature;
  if (signature.byteLength < 8 || signature[0] !== 0x30) throw new Error('INVALID_VAPID_SIGNATURE');
  let offset = 2;
  if (signature[1] & 0x80) {
    const lengthBytes = signature[1] & 0x7f;
    offset = 2 + lengthBytes;
  }
  if (signature[offset] !== 0x02) throw new Error('INVALID_VAPID_SIGNATURE');
  const rLength = signature[offset + 1];
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new Error('INVALID_VAPID_SIGNATURE');
  const sLength = signature[offset + 1];
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  return concat(leftPadInteger(r, 32), leftPadInteger(s, 32));
}

function leftPadInteger(value: Uint8Array, size: number): Uint8Array {
  let normalized = value;
  while (normalized.byteLength > size && normalized[0] === 0) normalized = normalized.slice(1);
  if (normalized.byteLength > size) throw new Error('INVALID_VAPID_SIGNATURE');
  const output = new Uint8Array(size);
  output.set(normalized, size - normalized.byteLength);
  return output;
}

function vapidSubject(value: string): string {
  const subject = boundedToken(value, 1000, 'INVALID_WEB_PUSH_SUBJECT');
  if (subject.startsWith('mailto:')) {
    if (!subject.slice('mailto:'.length).includes('@')) throw new Error('INVALID_WEB_PUSH_SUBJECT');
    return subject;
  }
  try {
    const url = new URL(subject);
    if (url.protocol !== 'https:' || !url.host || url.username || url.password) throw new Error();
    return subject;
  } catch {
    throw new Error('INVALID_WEB_PUSH_SUBJECT');
  }
}

function pushTopic(notificationId: number): string {
  const value = `aftertrace-${notificationId}`;
  return value.length <= 32 ? value : `aftertrace-${String(notificationId).slice(-20)}`;
}

function boundedToken(value: string, max: number, error: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function boundedText(value: string, max: number, error: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (normalized.length > max) throw new Error('INVALID_PUSH_DEEP_LINK');
  return normalized;
}

function decodeBase64Url(value: string, error: string): Uint8Array {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error(error);
  }
}

export function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}