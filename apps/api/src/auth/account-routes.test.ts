import { describe, expect, it, vi } from 'vitest';
import { issueWebSessionToken } from './token';
import { createAccountRoutes } from './account-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function headers(authorization: string) {
  return { authorization, origin: env.WEB_APP_ORIGIN };
}

describe('account profile routes', () => {
  it('returns provider-neutral display name and public account id from durable user id', async () => {
    const app = createAccountRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => ({
        async profile(userId) {
          return { userId, displayName: 'Ryan', publicAccountId: 'AT-23456789ABCD' };
        },
      }),
    });

    const response = await app.request('/profile', {
      headers: headers(await authorization()),
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      profile: {
        displayName: 'Ryan',
        publicAccountId: 'AT-23456789ABCD',
      },
    });
  });

  it('never requires provider email/id in the profile response', async () => {
    const app = createAccountRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => ({
        async profile(userId) {
          return { userId, displayName: null, publicAccountId: 'AT-3456789ABCDE' };
        },
      }),
    });

    const response = await app.request('/profile', {
      headers: headers(await authorization(9)),
    }, env);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain('lineUserId');
    expect(JSON.stringify(body)).not.toContain('email');
    expect(body).toEqual({
      ok: true,
      profile: { displayName: null, publicAccountId: 'AT-3456789ABCDE' },
    });
  });

  it('fails closed when an old prelaunch account has not been assigned a public id yet', async () => {
    const app = createAccountRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => ({ async profile() { return null; } }),
    });

    const response = await app.request('/profile', {
      headers: headers(await authorization()),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'ACCOUNT_PROFILE_NOT_READY' });
  });

  it('issues a bounded seven-day AFTERTRACE session for explicit extension handoff', async () => {
    const issueSession = vi.fn().mockResolvedValue('extension-session-token');
    const app = createAccountRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => ({ async profile() { return null; } }),
      issueSession,
    });

    const response = await app.request('/extension-session', {
      method: 'POST',
      headers: headers(await authorization(23)),
    }, env);

    expect(response.status).toBe(200);
    expect(issueSession).toHaveBeenCalledWith({
      userId: 23,
      secret: env.WEB_AUTH_SECRET,
      ttlSeconds: 60 * 60 * 24 * 7,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sessionToken: 'extension-session-token',
      expiresInSeconds: 60 * 60 * 24 * 7,
    });
  });
});
