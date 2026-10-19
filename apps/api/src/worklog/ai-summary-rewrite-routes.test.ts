import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createAiTextCaptureRoutes } from './ai-text-capture-routes';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
  GEMINI_API_KEY: 'unused-test-key',
};

async function headers() {
  return {
    authorization: `Bearer ${await issueWebSessionToken({ userId: 7, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 })}`,
    origin: env.WEB_APP_ORIGIN,
    'content-type': 'application/json',
  };
}
function unauthorizedEntitlement() { return { async snapshot() { return { sourceAuthorized: false, freeTrial: null, aiPro: null }; }, async ensureGrantScope() { throw new Error('scope should not be created'); } }; }
function trialEntitlement() { return { async snapshot() { return { sourceAuthorized: true, freeTrial: { grantId: 5, remainingPoints: 100, perRequestAiPointCap: 100 }, aiPro: null }; }, async ensureGrantScope() { throw new Error('scope should not be created without reservation'); } }; }
function aiProEntitlement() { return { async snapshot() { return { sourceAuthorized: true, freeTrial: null, aiPro: { planEnabled: true, aiEnabled: true, grantId: 8, periodStart: new Date('2026-09-01T00:00:00.000Z'), periodEnd: new Date('2026-10-01T00:00:00.000Z'), monthlyPointCap: 1000, monthlyProviderCostCapTwd: 30, perRequestAiPointCap: 200, pointsUsed: 0, providerCostTwd: 0, missingProviderCostTwdRequests: 0 } }; }, async ensureGrantScope() {} }; }

describe('summary/rewrite route boundaries', () => {
  it('does not query summary Records before Source authorization', async () => {
    let repositoryCalls = 0;
    const app = createAiTextCaptureRoutes({ databaseFactory: () => ({} as never), resolveSessionUserId: async (_database, session) => session.userId, entitlementRepositoryFactory: unauthorizedEntitlement, summaryRepositoryFactory: () => ({ async summaryEnabled() { repositoryCalls += 1; return true; }, async runtimeConfig() { repositoryCalls += 1; return null; }, async recordsForRange() { repositoryCalls += 1; return []; } }) });
    const response = await app.request('/summary', { method: 'POST', headers: await headers(), body: JSON.stringify({ sourceId: 99, from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z', timeZone: 'Asia/Taipei' }) }, env);
    expect(response.status).toBe(403); await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'SOURCE_NOT_AUTHORIZED' }); expect(repositoryCalls).toBe(0);
  });

  it('allows the FREE AI experience to reach summaries', async () => {
    let repositoryCalls = 0;
    const app = createAiTextCaptureRoutes({ databaseFactory: () => ({} as never), resolveSessionUserId: async (_database, session) => session.userId, entitlementRepositoryFactory: trialEntitlement, summaryRepositoryFactory: () => ({ async summaryEnabled() { repositoryCalls += 1; return true; }, async runtimeConfig() { repositoryCalls += 1; return null; }, async recordsForRange() { repositoryCalls += 1; return []; } }) });
    const response = await app.request('/summary', { method: 'POST', headers: await headers(), body: JSON.stringify({ sourceId: 12, from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z', timeZone: 'Asia/Taipei' }) }, env);
    expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'NO_RECORDS' }); expect(repositoryCalls).toBe(2);
  });

  it('returns NO_RECORDS for AI Pro without provider/ledger construction', async () => {
    let runtimeCalls = 0; let providerCalls = 0; let ledgerCalls = 0;
    const app = createAiTextCaptureRoutes({
      databaseFactory: () => ({} as never), resolveSessionUserId: async (_database, session) => session.userId, entitlementRepositoryFactory: aiProEntitlement,
      summaryRepositoryFactory: () => ({ async summaryEnabled() { return true; }, async runtimeConfig() { runtimeCalls += 1; return null; }, async recordsForRange() { return []; } }),
      ledgerRepositoryFactory: () => ({ async expireStaleReservations() { ledgerCalls += 1; return 0; } } as never),
      summaryProviderFactory: () => ({ reservationPoints() { providerCalls += 1; return 1; }, async summarize() { providerCalls += 1; throw new Error('provider should not run'); } }),
    });
    const response = await app.request('/summary', { method: 'POST', headers: await headers(), body: JSON.stringify({ sourceId: 12, from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z', timeZone: 'Asia/Taipei' }) }, env);
    expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ ok: true, status: 'NO_RECORDS' }); expect(runtimeCalls).toBe(0); expect(providerCalls).toBe(0); expect(ledgerCalls).toBe(0);
  });

  it('does not probe rewrite target existence before Source authorization', async () => {
    let rewriteCalls = 0;
    const app = createAiTextCaptureRoutes({ databaseFactory: () => ({} as never), resolveSessionUserId: async (_database, session) => session.userId, entitlementRepositoryFactory: unauthorizedEntitlement, rewriteRepositoryFactory: () => ({ async rewriteEnabled() { rewriteCalls += 1; return true; }, async runtimeConfig() { rewriteCalls += 1; return null; }, async recordForRewrite() { rewriteCalls += 1; return null; } }) });
    const response = await app.request('/rewrite', { method: 'POST', headers: await headers(), body: JSON.stringify({ sourceId: 99, recordId: 123, instruction: '改得更精簡' }) }, env);
    expect(response.status).toBe(403); await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'SOURCE_NOT_AUTHORIZED' }); expect(rewriteCalls).toBe(0);
  });

  it('allows the FREE AI experience to reach rewrite target lookup', async () => {
    let rewriteCalls = 0;
    const app = createAiTextCaptureRoutes({ databaseFactory: () => ({} as never), resolveSessionUserId: async (_database, session) => session.userId, entitlementRepositoryFactory: trialEntitlement, rewriteRepositoryFactory: () => ({ async rewriteEnabled() { rewriteCalls += 1; return true; }, async runtimeConfig() { rewriteCalls += 1; return null; }, async recordForRewrite() { rewriteCalls += 1; return null; } }) });
    const response = await app.request('/rewrite', { method: 'POST', headers: await headers(), body: JSON.stringify({ sourceId: 12, recordId: 123, instruction: '改得更精簡' }) }, env);
    expect(response.status).toBe(404); await expect(response.json()).resolves.toEqual({ ok: false, error: 'RECORD_NOT_FOUND' }); expect(rewriteCalls).toBe(2);
  });

  it('returns 409 for operator-disabled rewrite without reading the target Record', async () => {
    let targetReads = 0;
    const app = createAiTextCaptureRoutes({ databaseFactory: () => ({} as never), resolveSessionUserId: async (_database, session) => session.userId, entitlementRepositoryFactory: aiProEntitlement, rewriteRepositoryFactory: () => ({ async rewriteEnabled() { return false; }, async runtimeConfig() { throw new Error('runtime should not be read'); }, async recordForRewrite() { targetReads += 1; throw new Error('target should not be read'); } }) });
    const response = await app.request('/rewrite', { method: 'POST', headers: await headers(), body: JSON.stringify({ sourceId: 12, recordId: 123, instruction: '改得更精簡' }) }, env);
    expect(response.status).toBe(409); await expect(response.json()).resolves.toEqual({ ok: false, error: 'AI_REWRITE_DISABLED' }); expect(targetReads).toBe(0);
  });
});
