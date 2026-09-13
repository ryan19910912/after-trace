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

function requestHeaders(userId = 7) {
  return authorization(userId).then((authorizationHeader) => ({
    authorization: authorizationHeader,
    origin: env.WEB_APP_ORIGIN,
    'content-type': 'application/json',
  }));
}

function aiProSnapshot() {
  return {
    sourceAuthorized: true,
    freeTrial: null,
    aiPro: {
      planEnabled: true,
      aiEnabled: true,
      grantId: 8,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      monthlyPointCap: 1000,
      monthlyProviderCostCapTwd: 30,
      perRequestAiPointCap: 200,
      pointsUsed: 0,
      providerCostTwd: 0,
      missingProviderCostTwdRequests: 0,
    },
  };
}

describe('provider-backed AI capture routes', () => {
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
      headers: await requestHeaders(23),
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
      headers: await requestHeaders(),
      body: JSON.stringify({ sourceId: 'bad', text: 'test' }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_SOURCE_ID' });
    expect(repositoryCalls).toBe(0);
  });

  it('rejects unsupported audio MIME before entitlement/provider construction', async () => {
    let dependencyCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => { dependencyCalls += 1; throw new Error('should not construct'); },
      mediaRepositoryFactory: () => { dependencyCalls += 1; throw new Error('should not construct'); },
    });

    const response = await app.request('/audio', {
      method: 'POST',
      headers: await requestHeaders(),
      body: JSON.stringify({
        sourceId: 12,
        durationSeconds: 30,
        audio: { mimeType: 'video/mp4', dataBase64: 'YWJj' },
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_AUDIO_TYPE_UNSUPPORTED' });
    expect(dependencyCalls).toBe(0);
  });

  it('rejects malformed PDF/file base64 before entitlement/provider construction', async () => {
    let dependencyCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => { dependencyCalls += 1; throw new Error('should not construct'); },
      mediaRepositoryFactory: () => { dependencyCalls += 1; throw new Error('should not construct'); },
    });

    const response = await app.request('/file', {
      method: 'POST',
      headers: await requestHeaders(),
      body: JSON.stringify({
        sourceId: 12,
        file: { mimeType: 'application/pdf', dataBase64: 'not base64!' },
      }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_FILE_BASE64_INVALID' });
    expect(dependencyCalls).toBe(0);
  });

  it('rejects invalid natural-search timezone before constructing AI dependencies', async () => {
    let dependencyCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => { dependencyCalls += 1; throw new Error('should not construct'); },
      searchRepositoryFactory: () => { dependencyCalls += 1; throw new Error('should not construct'); },
    });

    const response = await app.request('/search', {
      method: 'POST',
      headers: await requestHeaders(),
      body: JSON.stringify({ sourceId: 12, query: '昨天晴空案的收款', timeZone: 'Not/A-Timezone' }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_SEARCH_TIMEZONE_INVALID' });
    expect(dependencyCalls).toBe(0);
  });

  it('returns 409 for operator-disabled natural search without runtime/provider execution', async () => {
    let runtimeCalls = 0;
    let providerCalls = 0;
    let ledgerCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => ({
        async snapshot() {
          return {
            sourceAuthorized: true,
            freeTrial: { grantId: 5, remainingPoints: 100, perRequestAiPointCap: 100 },
            aiPro: null,
          };
        },
        async ensureGrantScope() { throw new Error('scope should not be created before reservation'); },
      }),
      searchRepositoryFactory: () => ({
        async searchEnabled() { return false; },
        async runtimeConfig() { runtimeCalls += 1; throw new Error('runtime should not be read'); },
        async searchRecords() { throw new Error('records should not be queried'); },
      }),
      ledgerRepositoryFactory: () => ({
        async expireStaleReservations() { ledgerCalls += 1; return 0; },
      } as never),
      searchProviderFactory: () => ({
        reservationPoints() { providerCalls += 1; return 1; },
        async interpret() { providerCalls += 1; throw new Error('provider should not run'); },
      }),
    });

    const response = await app.request('/search', {
      method: 'POST',
      headers: await requestHeaders(),
      body: JSON.stringify({ sourceId: 12, query: '昨天晴空案的收款', timeZone: 'Asia/Taipei' }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_NATURAL_SEARCH_DISABLED' });
    expect(runtimeCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(ledgerCalls).toBe(0);
  });

  it('returns 403 for related Records before checking target existence when Source is unauthorized', async () => {
    let relatedCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => ({
        async snapshot() { return { sourceAuthorized: false, freeTrial: null, aiPro: null }; },
        async ensureGrantScope() { throw new Error('scope should not be created'); },
      }),
      relatedRepositoryFactory: () => ({
        async relatedEnabled() { relatedCalls += 1; return true; },
        async findRelated() { relatedCalls += 1; throw new Error('target should not be probed'); },
      }),
    });

    const response = await app.request('/related', {
      method: 'POST',
      headers: await requestHeaders(),
      body: JSON.stringify({ sourceId: 99, recordId: 123 }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'SOURCE_NOT_AUTHORIZED' });
    expect(relatedCalls).toBe(0);
  });

  it('returns 409 for operator-disabled related Records without querying a target Record', async () => {
    let findCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      entitlementRepositoryFactory: () => ({
        async snapshot() { return aiProSnapshot(); },
        async ensureGrantScope() { throw new Error('scope should not be needed for deterministic retrieval'); },
      }),
      relatedRepositoryFactory: () => ({
        async relatedEnabled() { return false; },
        async findRelated() { findCalls += 1; throw new Error('target should not be queried'); },
      }),
    });

    const response = await app.request('/related', {
      method: 'POST',
      headers: await requestHeaders(),
      body: JSON.stringify({ sourceId: 12, recordId: 55 }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_RELATED_RECORDS_DISABLED' });
    expect(findCalls).toBe(0);
  });
});
