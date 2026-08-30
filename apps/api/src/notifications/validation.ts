import { z } from 'zod';

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const decoded = atob(padded);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function isHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isP256dh(value: string): boolean {
  const decoded = decodeBase64Url(value);
  return decoded?.length === 65 && decoded[0] === 0x04;
}

function isAuthSecret(value: string): boolean {
  return decodeBase64Url(value)?.length === 16;
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1).max(4096).refine(isHttpsEndpoint, 'Push endpoint must be HTTPS'),
  expirationTime: z.number().finite().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256).refine(isP256dh, 'Invalid p256dh key'),
    auth: z.string().min(1).max(128).refine(isAuthSecret, 'Invalid auth secret'),
  }),
});

export const pushEndpointSchema = z.object({
  endpoint: z.string().min(1).max(4096).refine(isHttpsEndpoint, 'Push endpoint must be HTTPS'),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export function normalizePushSubscription(input: PushSubscriptionInput) {
  return {
    endpoint: input.endpoint.trim(),
    p256dh: input.keys.p256dh.replace(/=+$/, ''),
    authSecret: input.keys.auth.replace(/=+$/, ''),
  };
}

export function base64UrlToBytes(value: string): Uint8Array {
  const decoded = decodeBase64Url(value);
  if (!decoded) throw new Error('INVALID_BASE64URL');
  return decoded;
}
