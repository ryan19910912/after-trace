import { describe, expect, it } from 'vitest';
import { applicationServerKeyMatches } from './pwa';

describe('applicationServerKeyMatches', () => {
  it('matches the browser subscription key to the current base64url VAPID public key', () => {
    const subscriptionKey = Uint8Array.from([4, 1, 2, 3]).buffer;

    expect(applicationServerKeyMatches(subscriptionKey, 'BAECAw')).toBe(true);
  });

  it('rejects a rotated or otherwise different VAPID public key', () => {
    const subscriptionKey = Uint8Array.from([4, 1, 2, 3]).buffer;

    expect(applicationServerKeyMatches(subscriptionKey, 'BAECBA')).toBe(false);
  });

  it('rejects missing or malformed keys without throwing', () => {
    expect(applicationServerKeyMatches(null, 'BAECAw')).toBe(false);
    expect(applicationServerKeyMatches(Uint8Array.from([4, 1, 2, 3]).buffer, '%%%')).toBe(false);
  });
});
