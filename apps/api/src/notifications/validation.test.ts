import { describe, expect, it } from 'vitest';
import { normalizePushSubscription, pushEndpointSchema, pushSubscriptionSchema } from './validation';

const P256DH = 'BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU';
const AUTH = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('push subscription validation', () => {
  it('accepts a browser-style HTTPS subscription and normalizes key padding', () => {
    const parsed = pushSubscriptionSchema.parse({
      endpoint: 'https://push.example.test/subscription/abc',
      expirationTime: null,
      keys: { p256dh: `${P256DH}=`, auth: `${AUTH}==` },
    });
    expect(normalizePushSubscription(parsed)).toEqual({
      endpoint: 'https://push.example.test/subscription/abc',
      p256dh: P256DH,
      authSecret: AUTH,
    });
  });

  it('rejects non-HTTPS endpoints and malformed key material', () => {
    expect(pushEndpointSchema.safeParse({ endpoint: 'http://push.example.test/abc' }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({
      endpoint: 'https://push.example.test/abc',
      keys: { p256dh: 'abc', auth: 'abc' },
    }).success).toBe(false);
  });
});
