import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createAiEntitlementRoutes } from './ai-entitlement-routes';
import type { AiEntitlementRepository, AiEntitlementSnapshot } from './ai-entitlement';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function repository(snapshot: AiEntitlementSnapshot): AiEntitlementRepository {
  return {
    async snapshot() { return snapshot; },
    async ensureGrantScope() { throw new Error('GET entitlement must remain read-only'); },
  };
}

describe('AI entitlement route', () => {
  it('uses durable session userId and returns FREE_TRIAL for an authorized Source without mutating grant scope', async () => {
    let resolvedUserId = 0;
    const app = createAiEntitlementRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => { resolvedUserId = session.userId ?? 0; return session.userId; },
      repositoryFactory: () => repository({
        sourceAuthorized: true,
        freeTrial: { grantId: 9, remainingPoints: 80, perRequestAiPointCap: 50 },
        aiPro: null,
      }),
    });
    const response = await app.request('/?sourceId=12', {
      headers: { authorization: await authorization(23), origin: env.WEB_APP_ORIGIN },
    }, env);
    expect(response.status).toBe(200);
    expect(resolvedUserId).toBe(23);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      entitlement: {
        source: 'FREE_TRIAL', allowed: true, remainingPoints: 80, perRequestAiPointCap: 50,
      },
    });
  });

  it('returns BLOCKED rather than borrowing another GROUP members AI entitlement', async () => {
    const app = createAiEntitlementRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({ sourceAuthorized: false, freeTrial: null, aiPro: null }),
    });
    const response = await app.request('/?sourceId=99', {
      headers: { authorization: await authorization(), origin: env.WEB_APP_ORIGIN },
    }, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entitlement: { source: 'BLOCKED', allowed: false, reason: 'SOURCE_NOT_AUTHORIZED' },
    });
  });

  it('rejects an invalid Source id before entitlement lookup', async () => {
    let repositoryCalls = 0;
    const app = createAiEntitlementRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => { repositoryCalls += 1; return repository({ sourceAuthorized: true, freeTrial: null, aiPro: null }); },
    });
    const response = await app.request('/?sourceId=bad', {
      headers: { authorization: await authorization(), origin: env.WEB_APP_ORIGIN },
    }, env);
    expect(response.status).toBe(400);
    expect(repositoryCalls).toBe(0);
  });
});
