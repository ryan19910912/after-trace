import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createAiTextCaptureRoutes } from './ai-text-capture-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
  GEMINI_API_KEY: 'unused-test-key',
};

async function authorization(userId = 7) {
  return `Bearer ${await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 })}`;
}

describe('provider-backed AI text capture route', () => {
  it('fails Source authorization before runtime/provider/ledger execution', async () => {
    let runtimeCalls = 0;
    let providerCalls = 0;
    let ledgerCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => ({
        async snapshot() { return { sourceAuthorized: false, freeTrial: null, aiPro: null }; },
        async ensureGrantScope() { throw new Error('scope should not be created'); },
      }),
      captureRepositoryFactory: () => ({
        async runtimeConfig() { runtimeCalls += 1; throw new Error('runtime should not be read'); },
        async createAiRecord() { throw new Error('record should not be created'); },
      }),
      ledgerRepositoryFactory: () => ({
        async expireStaleReservations() { ledgerCalls += 1; return 0; },
      } as never),
      providerFactory: () => ({
        reservationPoints() { providerCalls += 1; return 1; },
        async normalize() { providerCalls += 1; throw new Error('provider should not run'); },
      }),
    });

    const response = await app.request('/text', {
      method: 'POST',
      headers: {
        authorization: await authorization(23),
        origin: env.WEB_APP_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceId: 99, text: '這筆資料不該進 provider' }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'SOURCE_NOT_AUTHORIZED',
      entitlement: { source: 'BLOCKED', allowed: false },
    });
    expect(runtimeCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(ledgerCalls).toBe(0);
  });

  it('rejects malformed Source ids before any AI dependency is used', async () => {
    let repositoryCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => { repositoryCalls += 1; throw new Error('should not construct'); },
    });

    const response = await app.request('/text', {
      method: 'POST',
      headers: {
        authorization: await authorization(),
        origin: env.WEB_APP_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceId: 'bad', text: 'test' }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_SOURCE_ID' });
    expect(repositoryCalls).toBe(0);
  });
});
