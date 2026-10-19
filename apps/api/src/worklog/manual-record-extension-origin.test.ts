import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { createManualRecordRoutes, type ManualRecordRouteRepository } from './manual-record-routes';

const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

const repository = {
  surfaces: async () => ({ personal: { sourceId: 10 }, groups: [] }),
} as unknown as ManualRecordRouteRepository;

function app() {
  return createManualRecordRoutes({
    databaseFactory: () => ({}) as Database,
    verifySession: async () => ({ type: 'WEB_SESSION', userId: 7, lineUserId: '', expiresAt: 4_000_000_000 }),
    resolveSessionUserId: async () => 7,
    repositoryFactory: () => repository,
  });
}

describe('Chrome extension manual Record client', () => {
  it('allows a canonical Chrome extension origin only with the normal bearer-session route', async () => {
    const response = await app().request('https://api.example.test/surfaces', {
      headers: {
        Origin: extensionOrigin,
        Authorization: 'Bearer aftertrace-session',
      },
    }, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(extensionOrigin);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      surfaces: { personal: { sourceId: 10 }, groups: [] },
    });
  });

  it('rejects unrelated browser origins before product data is exposed', async () => {
    const response = await app().request('https://api.example.test/surfaces', {
      headers: {
        Origin: 'https://evil.example.test',
        Authorization: 'Bearer aftertrace-session',
      },
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
  });
});
