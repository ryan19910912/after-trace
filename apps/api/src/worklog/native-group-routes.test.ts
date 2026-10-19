import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createNativeGroupRoutes } from './native-group-routes';
import type { NativeGroupSummary } from './native-groups';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

class FakeService {
  groups: NativeGroupSummary[] = [{ sourceId: 20, name: '產品群', role: 'OWNER' }];
  createInviteStatus: 'CREATED' | 'FORBIDDEN_OR_UNAVAILABLE' | 'TOKEN_CONFLICT' = 'CREATED';
  joinStatus: 'JOINED' | 'ALREADY_MEMBER' | 'INVALID_INVITE' = 'JOINED';
  revokeStatus: 'REVOKED' | 'FORBIDDEN_OR_NOT_FOUND' = 'REVOKED';

  async listGroups() {
    return this.groups;
  }

  async createGroup(input: { creatorUserId: number; name: string }) {
    return {
      status: 'CREATED' as const,
      group: { sourceId: 21, name: input.name.trim(), role: 'OWNER' as const },
    };
  }

  async createInvite(input: { sourceId: number }) {
    if (this.createInviteStatus !== 'CREATED') return { status: this.createInviteStatus } as const;
    return {
      status: 'CREATED' as const,
      token: 'one-time-raw-token',
      invite: {
        id: 30,
        sourceId: input.sourceId,
        expiresAt: null,
        maxUses: 1,
        useCount: 0,
        revokedAt: null,
        createdAt: '2026-09-07T00:00:00.000Z',
      },
    };
  }

  async revokeInvite() {
    return this.revokeStatus === 'REVOKED'
      ? { status: 'REVOKED' as const, inviteId: 30 }
      : { status: 'FORBIDDEN_OR_NOT_FOUND' as const };
  }

  async join() {
    if (this.joinStatus === 'INVALID_INVITE') return { status: 'INVALID_INVITE' as const };
    return {
      status: this.joinStatus,
      group: { sourceId: 20, name: '產品群', role: 'MEMBER' as const },
    };
  }
}

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function routes(service: FakeService) {
  return createNativeGroupRoutes({
    databaseFactory: () => ({} as never),
    resolveSessionUserId: async (_database, session) => session.userId,
    serviceFactory: () => service,
  });
}

function headers(authorization: string) {
  return {
    authorization,
    origin: env.WEB_APP_ORIGIN,
    'content-type': 'application/json',
  };
}

describe('native group routes', () => {
  it('uses durable web-session user id for list/create without LINE identity', async () => {
    const service = new FakeService();
    const auth = await authorization(7);

    const list = await routes(service).request('/', { headers: headers(auth) }, env);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ ok: true, groups: service.groups });

    const create = await routes(service).request('/', {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({ name: ' 新產品群 ' }),
    }, env);
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({
      ok: true,
      group: { sourceId: 21, name: '新產品群', role: 'OWNER' },
    });
  });

  it('returns a raw invite token only on successful owner invite creation', async () => {
    const service = new FakeService();
    const response = await routes(service).request('/20/invites', {
      method: 'POST',
      headers: headers(await authorization()),
      body: JSON.stringify({ maxUses: 1 }),
    }, env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      inviteToken: 'one-time-raw-token',
      invite: { id: 30, sourceId: 20, maxUses: 1 },
    });
  });

  it('maps non-owner invite creation to forbidden without leaking a token', async () => {
    const service = new FakeService();
    service.createInviteStatus = 'FORBIDDEN_OR_UNAVAILABLE';
    const response = await routes(service).request('/20/invites', {
      method: 'POST',
      headers: headers(await authorization(8)),
      body: JSON.stringify({}),
    }, env);

    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ ok: false, error: 'FORBIDDEN_OR_UNAVAILABLE' });
    expect(JSON.stringify(body)).not.toContain('inviteToken');
  });

  it('treats revoked expired exhausted or unknown tokens as the same invalid invite response', async () => {
    const service = new FakeService();
    service.joinStatus = 'INVALID_INVITE';
    const response = await routes(service).request('/join', {
      method: 'POST',
      headers: headers(await authorization(9)),
      body: JSON.stringify({ token: 'revoked-or-expired-token' }),
    }, env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_INVITE' });
  });

  it('keeps repeated join idempotent and never promotes through an invite', async () => {
    const service = new FakeService();
    service.joinStatus = 'ALREADY_MEMBER';
    const response = await routes(service).request('/join', {
      method: 'POST',
      headers: headers(await authorization(9)),
      body: JSON.stringify({ token: 'same-token' }),
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: 'ALREADY_MEMBER',
      group: { sourceId: 20, name: '產品群', role: 'MEMBER' },
    });
  });

  it('hides revoke authorization/not-found behind one response', async () => {
    const service = new FakeService();
    service.revokeStatus = 'FORBIDDEN_OR_NOT_FOUND';
    const response = await routes(service).request('/20/invites/30', {
      method: 'DELETE',
      headers: headers(await authorization(8)),
    }, env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'FORBIDDEN_OR_NOT_FOUND' });
  });
});
