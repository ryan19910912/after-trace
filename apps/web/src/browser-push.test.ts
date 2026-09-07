import { describe, expect, it } from 'vitest';
import { applicationServerKey, iosHomeScreenPushHint } from './browser-push';

describe('browser push helpers', () => {
  it('converts URL-safe VAPID public-key material into bytes', () => {
    const encoded = btoa('aftertrace-test-key').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(Array.from(applicationServerKey(encoded))).toEqual(Array.from(new TextEncoder().encode('aftertrace-test-key')));
  });

  it('fails closed on empty VAPID public keys', () => {
    expect(() => applicationServerKey('')).toThrowError('INVALID_PUSH_PUBLIC_KEY');
  });

  it('explicitly distinguishes iOS Home Screen PWA push from a normal Safari tab', () => {
    const hint = iosHomeScreenPushHint();
    expect(hint).toContain('加入主畫面');
    expect(hint).toContain('Safari');
  });
});
