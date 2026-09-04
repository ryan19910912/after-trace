import { describe, expect, it } from 'vitest';
import app, { type Bindings } from './index';

function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
    LINE_CHANNEL_SECRET: 'line-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-access-token',
    WEB_APP_URL: 'https://aftertrace-web.example.test',
    WEB_APP_ORIGIN: 'https://aftertrace-web.example.test',
    WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
    LINE_LOGIN_CHANNEL_ID: '1234567890',
    LINE_LOGIN_CHANNEL_SECRET: 'line-login-secret',
    GEMINI_API_KEY: 'gemini-key',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-password',
    ADMIN_SESSION_SECRET: 'abcdef0123456789abcdef0123456789',
    ADMIN_WEB_ORIGIN: 'https://aftertrace-admin.example.test',
    ...overrides,
  };
}

describe('API launch readiness', () => {
  it('fails before database access when a launch secret is missing', async () => {
    const response = await app.request('/health/ready', {}, env({ WEB_AUTH_SECRET: undefined }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      error: 'RUNTIME_CONFIG_INCOMPLETE',
      missing: expect.arrayContaining(['WEB_AUTH_SECRET']),
    });
  });

  it('rejects non-https production-facing origins before database access', async () => {
    const response = await app.request('/health/ready', {}, env({ ADMIN_WEB_ORIGIN: 'http://admin.example.test' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      missing: expect.arrayContaining(['ADMIN_WEB_ORIGIN']),
    });
  });

  it('keeps liveness independent from launch configuration', async () => {
    const response = await app.request('/health', {}, env({ WEB_AUTH_SECRET: undefined }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });
});
