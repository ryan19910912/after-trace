import { describe, expect, it } from 'vitest';
import { issueAdminSessionToken } from './auth';
import { createAdminRoutes } from './routes';

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

describe('admin route input validation', () => {
  it.each([
    ['/users/not-a-number', 'INVALID_USER_ID'],
    ['/groups/0', 'INVALID_GROUP_ID'],
  ])('returns 400 instead of throwing for malformed GET path %s', async (path, error) => {
    const response = await createAdminRoutes().request(path, {
      headers: { authorization: await authorization() },
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error });
  });

  it('returns 400 for malformed anomaly id before touching persistence', async () => {
    const response = await createAdminRoutes().request('/anomalies/-1', {
      method: 'PATCH',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'RESOLVED' }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'INVALID_ANOMALY_ID' });
  });

  it.each([
    [{ planCode: 'bad code with spaces' }, 'INVALID_PLAN_CODE'],
    [{ planCode: 'PRO', currentPeriodEnd: 'not-a-date' }, 'INVALID_PERIOD_END'],
  ])('returns 400 for malformed manual subscription input', async (body, error) => {
    const response = await createAdminRoutes().request('/users/1/subscription', {
      method: 'PUT',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error });
  });
});
