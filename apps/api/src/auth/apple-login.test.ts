import { describe, expect, it, vi } from 'vitest';
import { createAppleClientSecret, verifyAppleIdentityToken } from './apple-login';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('Apple Login crypto contract', () => {
  it('creates the developer client_secret with ES256 and Apple-required claims', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${standardBase64(pkcs8)}\n-----END PRIVATE KEY-----`;
    const clientSecret = await createAppleClientSecret({
      clientId: 'com.aftertrace.web',
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      privateKeyP8Base64: standardBase64(encoder.encode(pem)),
    }, new Date('2026-09-07T10:00:00.000Z'), 600);

    const [headerPart, payloadPart, signaturePart] = clientSecret.split('.');
    expect(JSON.parse(decoder.decode(base64UrlDecode(headerPart)))).toMatchObject({
      alg: 'ES256',
      kid: 'KEY1234567',
    });
    expect(JSON.parse(decoder.decode(base64UrlDecode(payloadPart)))).toMatchObject({
      iss: 'TEAM123456',
      aud: 'https://appleid.apple.com',
      sub: 'com.aftertrace.web',
    });
    expect(base64UrlDecode(signaturePart)).toHaveLength(64);
    await expect(crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      base64UrlDecode(signaturePart),
      encoder.encode(`${headerPart}.${payloadPart}`),
    )).resolves.toBe(true);
  });

  it('verifies Apple identity tokens as RS256 against Apple RSA JWKS', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const now = new Date('2026-09-07T10:00:00.000Z');
    const nonce = 'nonce-1234567890';
    const idToken = await signRs256(pair.privateKey, {
      iss: 'https://appleid.apple.com',
      aud: 'com.aftertrace.web',
      sub: 'apple-subject-1',
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 600,
      nonce,
      email: 'relay@example.test',
    });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      keys: [{ ...publicJwk, kid: 'apple-key-1', alg: 'RS256', use: 'sig' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(verifyAppleIdentityToken({
      idToken,
      clientId: 'com.aftertrace.web',
      expectedNonce: nonce,
      now,
      fetchFn: fetchFn as typeof fetch,
    })).resolves.toEqual({
      subject: 'apple-subject-1',
      emailSnapshot: 'relay@example.test',
    });
  });

  it('rejects an otherwise valid Apple identity token when nonce differs', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const now = new Date('2026-09-07T10:00:00.000Z');
    const idToken = await signRs256(pair.privateKey, {
      iss: 'https://appleid.apple.com',
      aud: 'com.aftertrace.web',
      sub: 'apple-subject-1',
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 600,
      nonce: 'expected-nonce',
    });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      keys: [{ ...publicJwk, kid: 'apple-key-1', alg: 'RS256', use: 'sig' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(verifyAppleIdentityToken({
      idToken,
      clientId: 'com.aftertrace.web',
      expectedNonce: 'different-nonce',
      now,
      fetchFn: fetchFn as typeof fetch,
    })).rejects.toMatchObject({ code: 'APPLE_ID_TOKEN_INVALID' });
  });

  it('rejects an ES256 identity token before accepting Apple signing keys', async () => {
    const fake = `${jsonPart({ alg: 'ES256', kid: 'wrong' })}.${jsonPart({
      iss: 'https://appleid.apple.com', aud: 'com.aftertrace.web', sub: 'x', exp: 9999999999, iat: 1, nonce: 'n',
    })}.AA`;
    await expect(verifyAppleIdentityToken({
      idToken: fake,
      clientId: 'com.aftertrace.web',
      expectedNonce: 'n',
    })).rejects.toMatchObject({ code: 'APPLE_ID_TOKEN_INVALID' });
  });
});

async function signRs256(privateKey: CryptoKey, payload: Record<string, unknown>): Promise<string> {
  const headerPart = jsonPart({ alg: 'RS256', kid: 'apple-key-1', typ: 'JWT' });
  const payloadPart = jsonPart(payload);
  const input = `${headerPart}.${payloadPart}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(input),
  ));
  return `${input}.${base64Url(signature)}`;
}

function jsonPart(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
  return standardBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function standardBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
