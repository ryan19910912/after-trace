import { describe, expect, it } from 'vitest';
import { issueAdminSessionToken } from './auth';
import { createAdminProfitabilityRoutes } from './profitability-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  ADMIN_USERNAME: 'operator',
  ADMIN_PASSWORD: 'correct horse battery staple',
  ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
  ADMIN_WEB_ORIGIN: 'https://admin.example.test',
};

async function authorization() {
  const token = await issueAdminSessionToken({ username: 'operator', env, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

describe('admin profitability route boundary', () => {
  it('requires an Admin session before touching persistence', async () => {
    const response = await createAdminProfitabilityRoutes().request('/', {}, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'ADMIN_SESSION_REQUIRED' });
  });

  it('rejects an unsupported period before touching persistence', async () => {
    const response = await createAdminProfitabilityRoutes().request('/?period=MONTH', {
      headers: { authorization: await authorization() },
    }, env);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'INVALID_PROFITABILITY_PERIOD' });
  });

  it('rejects a foreign browser origin before session/persistence work', async () => {
    const response = await createAdminProfitabilityRoutes().request('/', {
      headers: {
        authorization: await authorization(),
        origin: 'https://evil.example.test',
      },
    }, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
  });
});
