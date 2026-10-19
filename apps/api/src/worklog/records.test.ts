import { describe, expect, it } from 'vitest';
import {
  WorklogRecordReadService,
  type WorklogGroupSurface,
  type WorklogRecordListItem,
  type WorklogRecordReadRepository,
} from './records';

function record(sourceId: number, id = 1): WorklogRecordListItem {
  return {
    id,
    sourceId,
    title: null,
    authorUserId: 1,
    inputType: 'TEXT',
    rawText: 'test',
    occurredAt: '2026-09-02T00:00:00.000Z',
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
}

class FakeRepository implements WorklogRecordReadRepository {
  personalSources = new Map<number, number>();
  groupSurfaces = new Map<number, WorklogGroupSurface[]>();
  memberships = new Set<string>();
  records = new Map<number, WorklogRecordListItem[]>();
  listCalls: Array<{ sourceId: number; limit: number }> = [];

  async getActivePersonalSourceId(userId: number) { return this.personalSources.get(userId) ?? null; }
  async listActiveGroupSurfaces(userId: number) { return this.groupSurfaces.get(userId) ?? []; }
  async isActiveGroupMember(userId: number, sourceId: number) { return this.memberships.has(`${userId}:${sourceId}`); }
  async listRecordsBySource(sourceId: number, limit: number) {
    this.listCalls.push({ sourceId, limit });
    return this.records.get(sourceId) ?? [];
  }
}

describe('WorklogRecordReadService personal scope', () => {
  it('returns no Records when the authenticated user has no active PRIVATE Source', async () => {
    const repository = new FakeRepository();
    const service = new WorklogRecordReadService(repository);

    await expect(service.personalRecords(1)).resolves.toEqual([]);
    expect(repository.listCalls).toEqual([]);
  });

  it('reads only the authenticated user PRIVATE Source', async () => {
    const repository = new FakeRepository();
    repository.personalSources.set(1, 10);
    repository.records.set(10, [record(10)]);
    const service = new WorklogRecordReadService(repository);

    await expect(service.personalRecords(1)).resolves.toEqual([record(10)]);
    expect(repository.listCalls).toEqual([{ sourceId: 10, limit: 100 }]);
  });
});

describe('WorklogRecordReadService group scope', () => {
  it('refuses an arbitrary GROUP Source before querying Records', async () => {
    const repository = new FakeRepository();
    repository.records.set(99, [record(99)]);
    const service = new WorklogRecordReadService(repository);

    await expect(service.groupRecords(1, 99)).resolves.toEqual({ status: 'FORBIDDEN' });
    expect(repository.listCalls).toEqual([]);
  });

  it('allows only an active AFTERTRACE GROUP member to read the exact Source', async () => {
    const repository = new FakeRepository();
    repository.memberships.add('1:20');
    repository.records.set(20, [record(20)]);
    repository.records.set(21, [record(21)]);
    const service = new WorklogRecordReadService(repository);

    await expect(service.groupRecords(1, 20)).resolves.toEqual({ status: 'OK', records: [record(20)] });
    await expect(service.groupRecords(1, 21)).resolves.toEqual({ status: 'FORBIDDEN' });
    expect(repository.listCalls).toEqual([{ sourceId: 20, limit: 100 }]);
  });
});

describe('WorklogRecordReadService product surfaces', () => {
  it('returns provider-neutral personal and native GROUP surfaces', async () => {
    const repository = new FakeRepository();
    repository.personalSources.set(1, 10);
    repository.groupSurfaces.set(1, [
      { sourceId: 20, name: '產品群', role: 'OWNER' },
      { sourceId: 21, name: '客戶群', role: 'MEMBER' },
    ]);
    const service = new WorklogRecordReadService(repository);

    await expect(service.surfaces(1)).resolves.toEqual({
      personal: { sourceId: 10 },
      groups: [
        { sourceId: 20, name: '產品群', role: 'OWNER' },
        { sourceId: 21, name: '客戶群', role: 'MEMBER' },
      ],
    });
  });

  it('clamps list limits to the target bounded range', async () => {
    const repository = new FakeRepository();
    repository.personalSources.set(1, 10);
    const service = new WorklogRecordReadService(repository);

    await service.personalRecords(1, 9999);
    expect(repository.listCalls).toEqual([{ sourceId: 10, limit: 200 }]);
  });
});
