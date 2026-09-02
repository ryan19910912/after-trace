import { describe, expect, it } from 'vitest';
import type { CachedLineText } from './line-text-cache';
import {
  WorklogRecordReadService,
  WorklogRecordWriteService,
  type StoredTextRecordIdentity,
  type WorklogGroupSurface,
  type WorklogRecordListItem,
  type WorklogRecordReadRepository,
  type WorklogRecordWriteRepository,
} from './records';

function record(sourceId: number, id = 1): WorklogRecordListItem {
  return {
    id,
    sourceId,
    authorUserId: 1,
    inputType: 'TEXT',
    category: 'NOTE',
    rawText: 'test',
    normalizedSummary: null,
    customerId: null,
    projectId: null,
    sourceTimestamp: '2026-09-02T00:00:00.000Z',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
}

class FakeRepository implements WorklogRecordReadRepository {
  oaFriends = new Set<number>();
  personalSources = new Map<number, number>();
  groupSurfaces = new Map<number, WorklogGroupSurface[]>();
  memberships = new Set<string>();
  records = new Map<number, WorklogRecordListItem[]>();
  listCalls: number[] = [];

  async isOaFriend(userId: number) { return this.oaFriends.has(userId); }
  async getActivePersonalSourceId(userId: number) { return this.personalSources.get(userId) ?? null; }
  async listActiveGroupSurfaces(userId: number) { return this.groupSurfaces.get(userId) ?? []; }
  async isActiveGroupMember(userId: number, sourceId: number) { return this.memberships.has(`${userId}:${sourceId}`); }
  async listRecordsBySource(sourceId: number) { this.listCalls.push(sourceId); return this.records.get(sourceId) ?? []; }
}

class FakeWriteRepository implements WorklogRecordWriteRepository {
  result:
    | { status: 'CREATED'; record: StoredTextRecordIdentity }
    | { status: 'EXISTING'; record: StoredTextRecordIdentity }
    | { status: 'SOURCE_NOT_FOUND' } = { status: 'SOURCE_NOT_FOUND' };
  cache = new Map<string, CachedLineText>();

  async insertTextRecord() { return this.result; }
  async upsert(input: CachedLineText) { this.cache.set(`${input.lineGroupId}:${input.lineMessageId}`, input); }
  async pruneGroup() {}
  async findActive(lineGroupId: string, lineMessageId: string, now: Date) {
    const item = this.cache.get(`${lineGroupId}:${lineMessageId}`) ?? null;
    return item && item.expiresAt > now ? item : null;
  }
}

describe('WorklogRecordWriteService', () => {
  it('reports an identical replay as already recorded', async () => {
    const repository = new FakeWriteRepository();
    repository.result = { status: 'EXISTING', record: { id: 9, sourceId: 20, authorUserId: 3, lineMessageId: 'line-message-1', quotedLineMessageId: null, rawText: '王先生二樓漏水已修復' } };
    const service = new WorklogRecordWriteService(repository);
    await expect(service.recordText({ sourceId: 20, authorUserId: 3, lineMessageId: 'line-message-1', text: '王先生二樓漏水已修復', sourceTimestamp: new Date('2026-09-02T00:00:00Z') })).resolves.toEqual({ status: 'ALREADY_RECORDED', recordId: 9 });
  });

  it('detects a LINE message id replay with different content/source as a conflict', async () => {
    const repository = new FakeWriteRepository();
    repository.result = { status: 'EXISTING', record: { id: 9, sourceId: 99, authorUserId: 3, lineMessageId: 'line-message-1', quotedLineMessageId: null, rawText: 'different' } };
    const service = new WorklogRecordWriteService(repository);
    await expect(service.recordText({ sourceId: 20, authorUserId: 3, lineMessageId: 'line-message-1', text: '王先生二樓漏水已修復' })).resolves.toEqual({ status: 'IDEMPOTENCY_CONFLICT', recordId: 9 });
  });

  it('includes quoted LINE id in Reply-TEXT idempotency identity', async () => {
    const repository = new FakeWriteRepository();
    repository.result = { status: 'EXISTING', record: { id: 10, sourceId: 20, authorUserId: 3, lineMessageId: 'command-1', quotedLineMessageId: 'quoted-1', rawText: '原始文字' } };
    const service = new WorklogRecordWriteService(repository);
    await expect(service.recordQuotedText({ sourceId: 20, authorUserId: 3, lineMessageId: 'command-1', quotedLineMessageId: 'quoted-1', text: '原始文字' })).resolves.toEqual({ status: 'ALREADY_RECORDED', recordId: 10 });
  });

  it('enforces cache group isolation and expiry through the write service adapter', async () => {
    const repository = new FakeWriteRepository();
    const service = new WorklogRecordWriteService(repository);
    await service.remember({ lineMessageId: 'quoted-1', lineGroupId: 'group-a', lineUserId: 'user-1', text: '原始文字', lineTimestamp: new Date('2026-09-02T00:00:00Z') });
    await expect(service.resolve('group-b', 'quoted-1', new Date('2026-09-03T00:00:00Z'))).resolves.toBeNull();
    await expect(service.resolve('group-a', 'quoted-1', new Date('2026-09-03T00:00:00Z'))).resolves.toMatchObject({ text: '原始文字' });
    await expect(service.resolve('group-a', 'quoted-1', new Date('2026-09-08T00:00:00Z'))).resolves.toBeNull();
  });
});

describe('WorklogRecordReadService personal scope', () => {
  it('does not expose personal records to a user who is not an OA friend', async () => {
    const repository = new FakeRepository(); repository.personalSources.set(1, 10); repository.records.set(10, [record(10)]);
    const service = new WorklogRecordReadService(repository);
    await expect(service.personalRecords(1)).resolves.toEqual([]); expect(repository.listCalls).toEqual([]);
  });

  it('exposes only the OA friend personal source', async () => {
    const repository = new FakeRepository(); repository.oaFriends.add(1); repository.personalSources.set(1, 10); repository.records.set(10, [record(10)]);
    const service = new WorklogRecordReadService(repository);
    await expect(service.personalRecords(1)).resolves.toEqual([record(10)]); expect(repository.listCalls).toEqual([10]);
  });
});

describe('WorklogRecordReadService group scope', () => {
  it('refuses an arbitrary group source id before any record query runs', async () => {
    const repository = new FakeRepository(); repository.records.set(99, [record(99)]);
    const service = new WorklogRecordReadService(repository);
    await expect(service.groupRecords(1, 99)).resolves.toEqual({ status: 'FORBIDDEN' }); expect(repository.listCalls).toEqual([]);
  });

  it('allows only an active member to read the exact group source', async () => {
    const repository = new FakeRepository(); repository.memberships.add('1:20'); repository.records.set(20, [record(20)]); repository.records.set(21, [record(21)]);
    const service = new WorklogRecordReadService(repository);
    await expect(service.groupRecords(1, 20)).resolves.toEqual({ status: 'OK', records: [record(20)] });
    await expect(service.groupRecords(1, 21)).resolves.toEqual({ status: 'FORBIDDEN' }); expect(repository.listCalls).toEqual([20]);
  });
});

describe('WorklogRecordReadService PWA surfaces', () => {
  it('keeps personal and group surfaces separated for an OA friend who also belongs to groups', async () => {
    const repository = new FakeRepository(); repository.oaFriends.add(1); repository.personalSources.set(1, 10); repository.groupSurfaces.set(1, [{ sourceId: 20, lineGroupId: 'group-a' }, { sourceId: 21, lineGroupId: 'group-b' }]);
    const service = new WorklogRecordReadService(repository);
    await expect(service.surfaces(1)).resolves.toEqual({ personal: { sourceId: 10 }, groups: [{ sourceId: 20, lineGroupId: 'group-a' }, { sourceId: 21, lineGroupId: 'group-b' }] });
  });

  it('never adds a personal surface merely because the user has group access', async () => {
    const repository = new FakeRepository(); repository.personalSources.set(2, 11); repository.groupSurfaces.set(2, [{ sourceId: 30, lineGroupId: 'group-c' }]);
    const service = new WorklogRecordReadService(repository);
    await expect(service.surfaces(2)).resolves.toEqual({ personal: null, groups: [{ sourceId: 30, lineGroupId: 'group-c' }] });
  });
});
