import { describe, expect, it } from 'vitest';
import { createAppleAuthRoutes } from './apple-routes';

const configuredEnv = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_URL: 'https://web.example.test',
  WEB_APP_ORIGIN: 'https://web.example.test',
  APPLE_LOGIN_CLIENT_ID: 'com.aftertrace.web',
  APPLE_LOGIN_TEAM_ID: 'TEAM123456',
  APPLE_LOGIN_KEY_ID: 'KEY1234567',
  APPLE_LOGIN_PRIVATE_KEY_P8_BASE64: 'configured-but-not-used-by-start',
};

describe('Apple Login routes', () => {
  it('fails closed when Apple Login runtime config is incomplete', async () => {
    const app = createAppleAuthRoutes();
    const response = await app.request('/start', {}, {
      ...configuredEnv,
      APPLE_LOGIN_KEY_ID: '',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' });
  });

  it('starts a query-mode code flow with provider state and nonce but no email/name scope', async () => {
    const app = createAppleAuthRoutes();
    const response = await app.request('/start', {}, configuredEnv);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('response_mode')).toBe('query');
    expect(location.searchParams.get('client_id')).toBe('com.aftertrace.web');
    expect(location.searchParams.get('scope')).toBeNull();
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(response.headers.get('set-cookie')).toContain('aftertrace_apple_oauth=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
  });

  it('rejects callback without matching state/cookie before token exchange', async () => {
    const app = createAppleAuthRoutes();
    const response = await app.request('/callback?code=abc&state=wrong', {}, configuredEnv);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_APPLE_LOGIN_CALLBACK' });
  });
});
