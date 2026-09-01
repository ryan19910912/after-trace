import { describe, expect, it } from 'vitest';
import {
  WorklogBootstrapService,
  type WorklogBootstrapRepository,
  type WorklogBootstrapUser,
  type WorklogBoundGroup,
  type WorklogPendingGroup,
} from './bootstrap';

class FakeRepository implements WorklogBootstrapRepository {
  nextUserId = 1;
  nextWorkspaceId = 100;
  nextSourceId = 1000;
  nextPendingId = 5000;
  usersByLineId = new Map<string, WorklogBootstrapUser>();
  workspaces = new Map<number, number>();
  privateSources = new Map<number, number>();
  boundGroups = new Map<string, WorklogBoundGroup>();
  pendingGroups = new Map<string, WorklogPendingGroup>();
  pendingMembers = new Map<string, boolean>();
  boundMembers = new Map<string, boolean>();
  workspaceEnsureCalls: number[] = [];
  promoteCalls: Array<Parameters<WorklogBootstrapRepository['promoteGroup']>[0]> = [];

  async upsertLineUser(input: Parameters<WorklogBootstrapRepository['upsertLineUser']>[0]) {
    const existing = this.usersByLineId.get(input.lineUserId);
    if (existing) return existing;
    const created: WorklogBootstrapUser = {
      userId: this.nextUserId++,
      lineUserId: input.lineUserId,
      isOaFriend: false,
    };
    this.usersByLineId.set(input.lineUserId, created);
    return created;
  }

  async setOaFriendState(userId: number, isOaFriend: boolean) {
    for (const [lineId, user] of this.usersByLineId) {
      if (user.userId === userId) {
        this.usersByLineId.set(lineId, { ...user, isOaFriend });
        return;
      }
    }
  }

  async ensureWorkspace(ownerUserId: number) {
    this.workspaceEnsureCalls.push(ownerUserId);
    const existing = this.workspaces.get(ownerUserId);
    if (existing) return existing;
    const id = this.nextWorkspaceId++;
    this.workspaces.set(ownerUserId, id);
    return id;
  }

  async ensurePrivateSource(userId: number) {
    const existing = this.privateSources.get(userId);
    if (existing) return existing;
    const id = this.nextSourceId++;
    this.privateSources.set(userId, id);
    return id;
  }

  async findBoundGroupByLineId(lineGroupId: string) {
    return this.boundGroups.get(lineGroupId) ?? null;
  }

  async upsertPendingGroup(lineGroupId: string) {
    const existing = this.pendingGroups.get(lineGroupId);
    if (existing) return existing;
    const created: WorklogPendingGroup = {
      pendingGroupId: this.nextPendingId++,
      lineGroupId,
      isActive: true,
      promotedSourceId: null,
    };
    this.pendingGroups.set(lineGroupId, created);
    return created;
  }

  async upsertPendingGroupMember(pendingGroupId: number, userId: number, isActive: boolean) {
    this.pendingMembers.set(`${pendingGroupId}:${userId}`, isActive);
  }

  async upsertBoundGroupMember(sourceId: number, userId: number, isActive: boolean) {
    this.boundMembers.set(`${sourceId}:${userId}`, isActive);
  }

  async markGroupInactive(lineGroupId: string) {
    const bound = this.boundGroups.get(lineGroupId);
    if (bound) this.boundGroups.set(lineGroupId, { ...bound, status: 'INACTIVE' });
    const pending = this.pendingGroups.get(lineGroupId);
    if (pending) this.pendingGroups.set(lineGroupId, { ...pending, isActive: false });
  }

  async promoteGroup(input: Parameters<WorklogBootstrapRepository['promoteGroup']>[0]) {
    this.promoteCalls.push(input);
    const existing = this.boundGroups.get(input.lineGroupId);
    if (existing?.ownerUserId !== null && existing?.ownerUserId !== input.ownerUserId) return null;
    const source: WorklogBoundGroup = existing ?? {
      sourceId: this.nextSourceId++,
      lineGroupId: input.lineGroupId,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      status: 'ACTIVE',
    };
    const promoted = {
      ...source,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      status: 'ACTIVE' as const,
    };
    this.boundGroups.set(input.lineGroupId, promoted);

    const pending = this.pendingGroups.get(input.lineGroupId);
    if (pending) {
      this.pendingGroups.set(input.lineGroupId, {
        ...pending,
        isActive: false,
        promotedSourceId: promoted.sourceId,
      });
      for (const [key, active] of this.pendingMembers) {
        const [pendingId, userId] = key.split(':').map(Number);
        if (pendingId === pending.pendingGroupId) {
          this.boundMembers.set(`${promoted.sourceId}:${userId}`, active);
        }
      }
    }
    return promoted;
  }
}

describe('OA bootstrap', () => {
  it('creates a stable personal workspace/source on follow and preserves it across refollow', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    const at = new Date('2026-09-02T00:00:00Z');

    const first = await service.handleOaFollow({ lineUserId: 'U1', displayName: 'Ryan', at });
    await service.handleOaUnfollow({ lineUserId: 'U1', at: new Date('2026-09-03T00:00:00Z') });
    const second = await service.handleOaFollow({
      lineUserId: 'U1',
      displayName: 'Ryan 2',
      at: new Date('2026-09-04T00:00:00Z'),
    });

    expect(second).toEqual(first);
    expect(repository.usersByLineId.get('U1')?.isOaFriend).toBe(true);
    expect(repository.privateSources.size).toBe(1);
  });
});

describe('group bootstrap', () => {
  it('keeps an unowned group pending without inventing a workspace or owner', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const result = await service.bootstrapGroupInteraction({
      lineGroupId: 'C1',
      lineUserId: 'U2',
      at: new Date('2026-09-02T01:00:00Z'),
    });

    expect(result).toMatchObject({ status: 'PENDING_OWNER', userId: 1 });
    expect(repository.workspaceEnsureCalls).toEqual([]);
    expect(repository.promoteCalls).toEqual([]);
    expect(repository.pendingMembers.get('5000:1')).toBe(true);
  });

  it('promotes pending identity only after reliable actor/explicit owner evidence', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER' });
    const result = await service.bindGroupOwner({
      lineGroupId: 'C1',
      ownerLineUserId: 'OWNER',
      evidence: 'EXPLICIT_CLAIM',
      at: new Date('2026-09-02T02:00:00Z'),
    });

    expect(result.status).toBe('BOUND');
    if (result.status === 'BOUND') {
      expect(repository.boundMembers.get(`${result.sourceId}:1`)).toBe(true);
      expect(repository.boundMembers.get(`${result.sourceId}:2`)).toBe(true);
      expect(repository.pendingGroups.get('C1')?.promotedSourceId).toBe(result.sourceId);
    }
    expect(repository.promoteCalls[0]?.bindingMethod).toBe('EXPLICIT_CLAIM');
  });

  it('never reassigns an already-owned group to a different user', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const first = await service.bindGroupOwner({
      lineGroupId: 'C1',
      ownerLineUserId: 'OWNER-1',
      evidence: 'RELIABLE_JOIN_ACTOR',
    });
    const second = await service.bindGroupOwner({
      lineGroupId: 'C1',
      ownerLineUserId: 'OWNER-2',
      evidence: 'EXPLICIT_CLAIM',
    });

    expect(first.status).toBe('BOUND');
    expect(second).toMatchObject({ status: 'OWNER_CONFLICT', ownerUserId: 1 });
    expect(repository.promoteCalls).toHaveLength(1);
  });

  it('reactivates a known member without changing recording permission semantics', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    const bound = await service.bindGroupOwner({
      lineGroupId: 'C1',
      ownerLineUserId: 'OWNER',
      evidence: 'EXPLICIT_CLAIM',
    });
    if (bound.status !== 'BOUND') throw new Error('expected bound group');

    await service.setGroupMemberPresence({
      lineGroupId: 'C1',
      lineUserId: 'MEMBER',
      isActive: false,
    });
    await service.setGroupMemberPresence({
      lineGroupId: 'C1',
      lineUserId: 'MEMBER',
      isActive: true,
    });

    expect(repository.boundMembers.get(`${bound.sourceId}:2`)).toBe(true);
  });
});
