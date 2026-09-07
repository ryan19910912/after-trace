import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createAiTextCaptureRoutes } from './ai-text-capture-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
  GEMINI_API_KEY: 'unused-test-key',
};

async function headers(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return {
    authorization: `Bearer ${token}`,
    origin: env.WEB_APP_ORIGIN,
    'content-type': 'application/json',
  };
}

function unauthorizedEntitlement() {
  return {
    async snapshot() {
      return { sourceAuthorized: false, freeTrial: null, aiPro: null };
    },
    async ensureGrantScope() { throw new Error('scope must not be created'); },
  };
}

function trialEntitlement() {
  return {
    async snapshot() {
      return {
        sourceAuthorized: true,
        freeTrial: { grantId: 5, remainingPoints: 100, perRequestAiPointCap: 100 },
        aiPro: null,
      };
    },
    async ensureGrantScope() { throw new Error('scope should not be needed before reservation'); },
  };
}

describe('AI summary/rewrite routes', () => {
  it('rejects an invalid summary range before constructing AI dependencies', async () => {
    let dependencyFactories = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => { dependencyFactories += 1; throw new Error('should not construct'); },
      summaryRepositoryFactory: () => { dependencyFactories += 1; throw new Error('should not construct'); },
      ledgerRepositoryFactory: () => { dependencyFactories += 1; throw new Error('should not construct'); },
      summaryProviderFactory: () => { dependencyFactories += 1; throw new Error('should not construct'); },
    });

    const response = await app.request('/summary', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        sourceId: 12,
        from: '2026-09-08T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        timeZone: 'Asia/Taipei',
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_SUMMARY_RANGE_INVALID' });
    expect(dependencyFactories).toBe(0);
  });

  it('blocks summary before any Record retrieval or provider execution when Source is unauthorized', async () => {
    let recordCalls = 0;
    let providerCalls = 0;
    let ledgerCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: unauthorizedEntitlement,
      summaryRepositoryFactory: () => ({
        async summaryEnabled() { recordCalls += 1; return true; },
        async runtimeConfig() { recordCalls += 1; throw new Error('runtime should not be read'); },
        async recordsForRange() { recordCalls += 1; throw new Error('records should not be queried'); },
      }),
      ledgerRepositoryFactory: () => ({
        async expireStaleReservations() { ledgerCalls += 1; return 0; },
      } as never),
      summaryProviderFactory: () => ({
        reservationPoints() { providerCalls += 1; return 1; },
        async summarize() { providerCalls += 1; throw new Error('provider should not run'); },
      }),
    });

    const response = await app.request('/summary', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        sourceId: 99,
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-08T00:00:00.000Z',
        timeZone: 'Asia/Taipei',
      }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'SOURCE_NOT_AUTHORIZED' });
    expect(recordCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(ledgerCalls).toBe(0);
  });

  it('blocks rewrite before probing target Record existence when Source is unauthorized', async () => {
    let recordCalls = 0;
    let providerCalls = 0;
    let ledgerCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: unauthorizedEntitlement,
      rewriteRepositoryFactory: () => ({
        async rewriteEnabled() { recordCalls += 1; return true; },
        async runtimeConfig() { recordCalls += 1; throw new Error('runtime should not be read'); },
        async recordForRewrite() { recordCalls += 1; throw new Error('target should not be probed'); },
      }),
      ledgerRepositoryFactory: () => ({
        async expireStaleReservations() { ledgerCalls += 1; return 0; },
      } as never),
      rewriteProviderFactory: () => ({
        reservationPoints() { providerCalls += 1; return 1; },
        async rewrite() { providerCalls += 1; throw new Error('provider should not run'); },
      }),
    });

    const response = await app.request('/rewrite', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ sourceId: 99, recordId: 123, instruction: '精簡內容' }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'SOURCE_NOT_AUTHORIZED' });
    expect(recordCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(ledgerCalls).toBe(0);
  });

  it('returns 409 for operator-disabled rewrite without target lookup, reservation or provider execution', async () => {
    let targetCalls = 0;
    let providerCalls = 0;
    let ledgerCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: trialEntitlement,
      rewriteRepositoryFactory: () => ({
        async rewriteEnabled() { return false; },
        async runtimeConfig() { throw new Error('runtime should not be read'); },
        async recordForRewrite() { targetCalls += 1; throw new Error('target should not be queried'); },
      }),
      ledgerRepositoryFactory: () => ({
        async expireStaleReservations() { ledgerCalls += 1; return 0; },
      } as never),
      rewriteProviderFactory: () => ({
        reservationPoints() { providerCalls += 1; return 1; },
        async rewrite() { providerCalls += 1; throw new Error('provider should not run'); },
      }),
    });

    const response = await app.request('/rewrite', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ sourceId: 12, recordId: 55, instruction: '改得更清楚' }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_REWRITE_DISABLED' });
    expect(targetCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(ledgerCalls).toBe(0);
  });
});
