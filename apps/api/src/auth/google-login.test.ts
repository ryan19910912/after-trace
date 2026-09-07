import { describe, expect, it } from 'vitest';
import { createWebAuthRoutes } from './routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  LINE_CHANNEL_ACCESS_TOKEN: 'unused',
  LINE_CHANNEL_SECRET: 'unused',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_URL: 'https://web.example.test',
  WEB_APP_ORIGIN: 'https://web.example.test',
  GOOGLE_LOGIN_CLIENT_ID: 'google-client-id',
  GOOGLE_LOGIN_CLIENT_SECRET: 'google-client-secret',
};

describe('Google Login route', () => {
  it('starts Google OAuth with PKCE and provider-specific state cookie', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('/google/start', { method: 'GET' }, env);

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const authorize = new URL(location!);
    expect(authorize.origin).toBe('https://accounts.google.com');
    expect(authorize.searchParams.get('client_id')).toBe('google-client-id');
    expect(authorize.searchParams.get('scope')).toBe('openid profile email');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorize.searchParams.get('state')).toBeTruthy();
    expect(response.headers.get('set-cookie')).toContain('aftertrace_google_oauth=');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/v1/auth/google');
  });

  it('fails closed when Google Login is not configured', async () => {
    const app = createWebAuthRoutes();
    const response = await app.request('/google/start', { method: 'GET' }, {
      ...env,
      GOOGLE_LOGIN_CLIENT_ID: undefined,
      GOOGLE_LOGIN_CLIENT_SECRET: undefined,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'GOOGLE_LOGIN_NOT_CONFIGURED' });
  });
});
