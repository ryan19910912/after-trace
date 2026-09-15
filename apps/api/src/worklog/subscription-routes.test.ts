import { describe, expect, it } from 'vitest';
import { createWorklogSubscriptionRoutes } from './subscription-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

describe('subscription route boundary', () => {
  it('requires a valid web session before exposing backend-driven plans', async () => {
    const response = await createWorklogSubscriptionRoutes().request('/plans', {
      headers: { origin: env.WEB_APP_ORIGIN },
    }, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'WEB_SESSION_REQUIRED',
    });
  });
});
