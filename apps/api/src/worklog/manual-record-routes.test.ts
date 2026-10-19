import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import {
  createManualRecordRoutes,
  type ManualRecordRouteRepository,
  type ManualRecordView,
} from './manual-record-routes';

const env = {
  DATABASE_URL: 'postgresql://user:password@unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

function record(overrides: Partial<ManualRecordView> = {}): ManualRecordView {
  return {
    id: 100,
    sourceId: 10,
    title: null,
    authorUserId: 7,
    authorDisplayName: 'Ryan',
    inputType: 'TEXT',
    rawText: 'content only',
    captureContext: null,
    occurredAt: null,
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

class FakeRepository implements ManualRecordRouteRepository {
  records = new Map<number, ManualRecordView>([[100, record()]]);
  groupAllowed = true;
  lastCreate: Parameters<ManualRecordRouteRepository['create']>[0] | null = null;
  lastMutate: Parameters<ManualRecordRouteRepository['mutate']>[0] | null = null;

  async surfaces() {
    return {
      personal: { sourceId: 10 },
      groups: [{ sourceId: 20, name: '產品群', role: 'OWNER' as const }],
    };
  }

  async personalSourceId() { return 10; }

  async hasGroupAccess(_userId: number, sourceId: number) {
    return this.groupAllowed && sourceId === 20;
  }

  async listRecords(input: Parameters<ManualRecordRouteRepository['listRecords']>[0]) {
    const rows = [...this.records.values()].filter((value) => value.status === input.status);
    return {
      records: rows,
      page: { limit: input.filters.limit, offset: input.filters.offset, hasMore: false, nextOffset: null },
    };
  }

  async record(recordId: number) { return this.records.get(recordId) ?? null; }

  async create(input: Parameters<ManualRecordRouteRepository['create']>[0]) {
    this.lastCreate = input;
    const created = record({
      id: 101,
      sourceId: input.sourceId,
      authorUserId: input.actorUserId,
      rawText: input.rawText,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      title: input.title,
      captureContext: input.captureContext,
    });
    this.records.set(created.id, created);
    return created;
  }

  async mutate(input: Parameters<ManualRecordRouteRepository['mutate']>[0]) {
    this.lastMutate = input;
    const current = this.records.get(input.recordId);
    if (!current || current.version !== input.expectedVersion) return null;
    const updated = record({
      ...current,
      rawText: input.rawText,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      status: input.status,
      version: current.version + 1,
      deletedAt: input.deletedAt?.toISOString() ?? null,
      updatedAt: '2026-09-07T01:00:00.000Z',
    });
    this.records.set(updated.id, updated);
    return updated;
  }

  async revisions() { return []; }
}

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function headers(authorization: string) {
  return {
    authorization,
    origin: env.WEB_APP_ORIGIN,
    'content-type': 'application/json',
  };
}

function routes(repository: FakeRepository) {
  return createManualRecordRoutes({
    databaseFactory: () => ({} as never),
    resolveSessionUserId: async (_database, session) => session.userId,
    repositoryFactory: () => repository,
  });
}

describe('manual record routes', () => {
  it('lets a durable user-id session reach target surfaces', async () => {
    const repository = new FakeRepository();
    const response = await routes(repository).request('/surfaces', {
      headers: headers(await authorization()),
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      userId: 7,
      surfaces: { personal: { sourceId: 10 }, groups: [{ sourceId: 20, name: '產品群', role: 'OWNER' }] },
    });
  });

  it('creates a content-only free Record with nullable event date and no title', async () => {
    const repository = new FakeRepository();
    const response = await routes(repository).request('/records/personal', {
      method: 'POST',
      headers: headers(await authorization()),
      body: JSON.stringify({ content: '  今天先記這件事  ' }),
    }, env);

    expect(response.status).toBe(201);
    expect(repository.lastCreate).toMatchObject({
      sourceId: 10,
      actorUserId: 7,
      rawText: '今天先記這件事',
      occurredAt: null,
      title: null,
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      record: { rawText: '今天先記這件事', occurredAt: null, title: null },
    });
  });

  it('rejects retired Entity input explicitly', async () => {
    const repository = new FakeRepository();
    const response = await routes(repository).request('/records/personal', {
      method: 'POST',
      headers: headers(await authorization()),
      body: JSON.stringify({ rawText: '不接受舊 Entity', entityId: 3 }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'LEGACY_ENTITY_NOT_SUPPORTED' });
    expect(repository.lastCreate).toBeNull();
  });

  it('rejects malformed occurredAt but allows explicitly clearing an event date', async () => {
    const repository = new FakeRepository();
    repository.records.set(100, record({ occurredAt: '2026-09-06T12:00:00.000Z' }));

    const invalid = await routes(repository).request('/records/100', {
      method: 'PATCH',
      headers: headers(await authorization()),
      body: JSON.stringify({ expectedVersion: 1, occurredAt: 'not-a-date' }),
    }, env);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ ok: false, error: 'INVALID_OCCURRED_AT' });

    const cleared = await routes(repository).request('/records/100', {
      method: 'PATCH',
      headers: headers(await authorization()),
      body: JSON.stringify({ expectedVersion: 1, occurredAt: null }),
    }, env);
    expect(cleared.status).toBe(200);
    expect(repository.lastMutate?.occurredAt).toBeNull();
    await expect(cleared.json()).resolves.toMatchObject({ ok: true, record: { occurredAt: null, version: 2 } });
  });

  it('enforces group membership before listing or creating records', async () => {
    const repository = new FakeRepository();
    repository.groupAllowed = false;
    const response = await routes(repository).request('/records/group/20', {
      headers: headers(await authorization()),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' });
  });

  it('preserves optimistic versions across delete and restore', async () => {
    const repository = new FakeRepository();
    const deleted = await routes(repository).request('/records/100', {
      method: 'DELETE',
      headers: headers(await authorization()),
      body: JSON.stringify({ expectedVersion: 1 }),
    }, env);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ record: { status: 'DELETED', version: 2 } });

    const restored = await routes(repository).request('/records/100/restore', {
      method: 'POST',
      headers: headers(await authorization()),
      body: JSON.stringify({ expectedVersion: 2 }),
    }, env);
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ record: { status: 'ACTIVE', version: 3 } });
  });
});