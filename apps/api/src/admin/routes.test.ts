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

  it('rejects the retired aggregate allowance plan field before touching persistence', async () => {
    const response = await createAdminRoutes().request('/plans/PRO', {
      method: 'PUT',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Pro',
        priceTwd: '299',
        rank: 10,
        enabled: true,
        aiAllowanceUnits: 1_000_000,
        capabilities: {},
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'INVALID_SUBSCRIPTION_PERIOD_POINTS',
    });
  });

  it('rejects enabling customer export until the export API/UI is actually shipped', async () => {
    const response = await createAdminRoutes().request('/plans/PRO', {
      method: 'PUT',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Pro',
        priceTwd: '299',
        rank: 10,
        enabled: true,
        subscriptionPeriodPoints: 800_000,
        capabilities: { export: true },
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'CAPABILITY_NOT_SHIPPED_export',
    });
  });

  it.each([
    [{ priceTwd: '1', subscriptionPeriodPoints: 0 }, 'FREE_PLAN_REQUIRES_ZERO_PRICE'],
    [{ priceTwd: '0', subscriptionPeriodPoints: 1 }, 'FREE_PLAN_REQUIRES_ZERO_PERIOD_POINTS'],
  ])('keeps the frozen FREE plan shell invariant before persistence', async (override, error) => {
    const body = Object.assign({
      displayName: 'Free',
      priceTwd: '0',
      rank: 0,
      enabled: true,
      subscriptionPeriodPoints: 0,
      capabilities: { export: false },
    }, override);
    const response = await createAdminRoutes().request('/plans/FREE', {
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

  it('requires a positive output reference price for AI point conversion', async () => {
    const response = await createAdminRoutes().request('/ai-runtime', {
      method: 'PUT',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'GOOGLE',
        model: 'gemini-3.5-flash-lite',
        inputUsdPerMillion: '0.1',
        outputUsdPerMillion: '0',
        audioUsdPerMillion: null,
        imageUsdPerMillion: null,
        usdTwdRate: '30',
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'AI_OUTPUT_PRICE_MUST_BE_POSITIVE',
    });
  });

  it('rejects an AI provider that the shipped Worklog runtime cannot execute', async () => {
    const response = await createAdminRoutes().request('/ai-runtime', {
      method: 'PUT',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'OTHER',
        model: 'future-model-name',
        inputUsdPerMillion: '0.1',
        outputUsdPerMillion: '0.4',
        audioUsdPerMillion: null,
        imageUsdPerMillion: null,
        usdTwdRate: '30',
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'AI_PROVIDER_NOT_SUPPORTED' });
  });

  it('requires a non-empty AI model identifier without allowlisting model names', async () => {
    const response = await createAdminRoutes().request('/ai-runtime', {
      method: 'PUT',
      headers: {
        authorization: await authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'GOOGLE',
        model: '   ',
        inputUsdPerMillion: '0.1',
        outputUsdPerMillion: '0.4',
        audioUsdPerMillion: null,
        imageUsdPerMillion: null,
        usdTwdRate: '30',
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'INVALID_AI_MODEL' });
  });
});
