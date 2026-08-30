import { describe, expect, it } from 'vitest';
import { createVapidAuthorization, resolveVapidConfig } from './vapid';

const PUBLIC_KEY = 'BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU';
const PRIVATE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE';

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJson(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Record<string, unknown>;
}

describe('VAPID', () => {
  it('builds a verifiable ES256 JWT for the push endpoint origin', async () => {
    const config = {
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      subject: 'mailto:ops@example.test',
    };
    const authorization = await createVapidAuthorization(
      'https://push.example.test/send/abc',
      config,
      new Date('2026-08-31T00:00:00Z'),
    );

    expect(authorization.startsWith('vapid t=')).toBe(true);
    const token = authorization.slice('vapid t='.length).split(', k=')[0];
    const [header, payload, signature] = token.split('.');
    expect(decodeJson(header)).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(decodeJson(payload)).toMatchObject({
      aud: 'https://push.example.test',
      sub: 'mailto:ops@example.test',
    });

    const key = await crypto.subtle.importKey(
      'raw',
      decodeBase64Url(PUBLIC_KEY),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(verified).toBe(true);
  });

  it('does not invent a default contact or partial key configuration', () => {
    expect(resolveVapidConfig({ DATABASE_URL: 'postgres://example' })).toBeNull();
    expect(() => resolveVapidConfig({
      DATABASE_URL: 'postgres://example',
      WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
      WEB_PUSH_VAPID_PRIVATE_KEY: PRIVATE_KEY,
      WEB_PUSH_VAPID_SUBJECT: 'not-a-contact-uri',
    })).toThrow('INVALID_VAPID_SUBJECT');
  });
});
