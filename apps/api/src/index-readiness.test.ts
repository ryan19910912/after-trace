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
    ADMIN_PASSWORD: 'correct horse battery staple',
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

  it('rejects a weak Admin password before database access', async () => {
    const response = await app.request('/health/ready', {}, env({ ADMIN_PASSWORD: 'too-short' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      error: 'RUNTIME_CONFIG_INCOMPLETE',
      missing: expect.arrayContaining(['ADMIN_PASSWORD']),
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

  it('rejects Web URL and CORS origin that do not resolve to the same origin', async () => {
    const response = await app.request('/health/ready', {}, env({
      WEB_APP_URL: 'https://aftertrace-web.example.test',
      WEB_APP_ORIGIN: 'https://other-web.example.test',
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      missing: expect.arrayContaining(['WEB_APP_URL', 'WEB_APP_ORIGIN']),
    });
  });

  it('rejects origin bindings with path, query, hash, or credentials', async () => {
    const response = await app.request('/health/ready', {}, env({
      WEB_APP_URL: 'https://aftertrace-web.example.test/?preview=1',
      ADMIN_WEB_ORIGIN: 'https://admin:secret@aftertrace-admin.example.test',
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      missing: expect.arrayContaining(['WEB_APP_URL', 'ADMIN_WEB_ORIGIN']),
    });
  });

  it('keeps liveness independent from launch configuration', async () => {
    const response = await app.request('/health', {}, env({ WEB_AUTH_SECRET: undefined }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });
});
