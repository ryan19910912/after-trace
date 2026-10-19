import { describe, expect, it } from 'vitest';
import { createWebAuthRoutes } from './routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  LINE_CHANNEL_ACCESS_TOKEN: 'unused',
  LINE_CHANNEL_SECRET: 'unused',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_URL: 'https://web.example.test',
  WEB_APP_ORIGIN: 'https://web.example.test',
  APPLE_LOGIN_CLIENT_ID: 'com.example.aftertrace.web',
  APPLE_LOGIN_TEAM_ID: 'TEAM123456',
  APPLE_LOGIN_KEY_ID: 'KEY1234567',
  APPLE_LOGIN_PRIVATE_KEY_P8_BASE64: 'placeholder-private-key',
};

describe('Apple Login routes', () => {
  it('starts Sign in with Apple using form_post, nonce and cross-site callback cookie', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('https://api.example.test/apple/start', { method: 'GET' }, env);

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const authorize = new URL(location!);
    expect(authorize.origin).toBe('https://appleid.apple.com');
    expect(authorize.pathname).toBe('/auth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('com.example.aftertrace.web');
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('response_mode')).toBe('form_post');
    expect(authorize.searchParams.get('scope')).toBe('name email');
    expect(authorize.searchParams.get('state')).toBeTruthy();
    expect(authorize.searchParams.get('nonce')).toBeTruthy();
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/v1/auth/apple/callback');

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('aftertrace_apple_oauth=');
    expect(cookie).toContain('Path=/api/v1/auth/apple');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
  });

  it('fails closed when Apple Login is not configured', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('https://api.example.test/apple/start', { method: 'GET' }, {
      ...env,
      APPLE_LOGIN_PRIVATE_KEY_P8_BASE64: undefined,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'APPLE_LOGIN_NOT_CONFIGURED' });
  });

  it('does not apply Web CORS origin rejection to the signed Apple form_post callback', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('https://api.example.test/apple/callback', {
      method: 'POST',
      headers: {
        Origin: 'https://appleid.apple.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'state=missing-cookie&code=test-code',
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_APPLE_LOGIN_CALLBACK' });
  });

  it('requires HTTPS for the registered Apple return URL', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('http://localhost/apple/start', { method: 'GET' }, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'APPLE_LOGIN_HTTPS_CALLBACK_REQUIRED' });
  });
});
