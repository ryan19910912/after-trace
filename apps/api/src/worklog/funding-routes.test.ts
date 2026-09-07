import { describe, expect, it } from 'vitest';
import { createWorklogFundingRoutes } from './funding-routes';

describe('retired worklog funding routes', () => {
  it('fails the old personal funding surface closed without requiring auth/database state', async () => {
    const app = createWorklogFundingRoutes();

    const response = await app.request('/personal', { method: 'GET' }, {} as never);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'LEGACY_GROUP_FUNDING_DISABLED',
      subscriptionPath: '/api/v1/subscription',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not retain a mutable GROUP AI responsible-user/funding endpoint', async () => {
    const app = createWorklogFundingRoutes();

    const response = await app.request('/group/123/responsible-user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 99 }),
    }, {} as never);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'LEGACY_GROUP_FUNDING_DISABLED',
    });
  });
});
