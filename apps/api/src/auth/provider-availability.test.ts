import { describe, expect, it } from 'vitest';
import { createWebAuthRoutes } from './routes';
import { loginProviderAvailability } from './provider-availability';

const shared = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  LINE_CHANNEL_ACCESS_TOKEN: 'unused',
  LINE_CHANNEL_SECRET: 'unused',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_URL: 'https://web.example.test',
  WEB_APP_ORIGIN: 'https://web.example.test',
  LINE_LOGIN_CHANNEL_ID: 'line-channel',
  LINE_LOGIN_CHANNEL_SECRET: 'line-secret',
  GOOGLE_LOGIN_CLIENT_ID: 'google-client',
  GOOGLE_LOGIN_CLIENT_SECRET: 'google-secret',
};

describe('login provider availability', () => {
  it('fails closed for every provider when shared auth/session configuration is incomplete', () => {
    expect(loginProviderAvailability({
      ...shared,
      WEB_AUTH_SECRET: 'too-short',
    })).toEqual({ google: false, line: false, apple: false });
  });

  it('keeps Google and LINE available while optional Apple is unconfigured', () => {
    expect(loginProviderAvailability(shared)).toEqual({
      google: true,
      line: true,
      apple: false,
    });
  });

  it('enables Apple only when all Apple credentials are present', () => {
    expect(loginProviderAvailability({
      ...shared,
      APPLE_LOGIN_CLIENT_ID: 'com.example.aftertrace.web',
      APPLE_LOGIN_TEAM_ID: 'TEAM123456',
      APPLE_LOGIN_KEY_ID: 'KEY1234567',
      APPLE_LOGIN_PRIVATE_KEY_P8_BASE64: 'pem-base64',
    })).toEqual({ google: true, line: true, apple: true });
  });

  it('exposes only booleans from the public providers endpoint', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('https://api.example.test/providers', {
      headers: { Origin: 'https://web.example.test' },
    }, shared);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: { google: true, line: true, apple: false },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://web.example.test');
  });
});
