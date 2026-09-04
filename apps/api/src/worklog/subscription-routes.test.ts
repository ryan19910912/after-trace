import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createWorklogSubscriptionRoutes } from './subscription-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

async function authorization() {
  const token = await issueWebSessionToken({
    lineUserId: 'U0123456789abcdef0123456789abcdef',
    secret: env.WEB_AUTH_SECRET,
    ttlSeconds: 3600,
  });
  return `Bearer ${token}`;
}

describe('subscription route launch boundary', () => {
  it('fails closed before persistence while payment checkout is disabled', async () => {
    const response = await createWorklogSubscriptionRoutes().request('/checkout-intents', {
      method: 'POST',
      headers: {
        authorization: await authorization(),
        origin: env.WEB_APP_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        planCode: 'PRO',
        requestKey: 'web_0123456789abcdef0123456789abcdef',
      }),
    }, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'CHECKOUT_NOT_ENABLED',
    });
  });
});
