import { describe, expect, it } from 'vitest';
import {
  WorklogBootstrapService,
  type WorklogBootstrapRepository,
  type WorklogBootstrapUser,
  type WorklogBoundGroup,
} from './bootstrap';

class FakeRepository implements WorklogBootstrapRepository {
  nextUserId = 1;
  nextWorkspaceId = 100;
  nextSourceId = 1000;
  usersByLineId = new Map<string, WorklogBootstrapUser>();
  workspaces = new Map<number, number>();
  privateSources = new Map<number, number>();
  boundGroups = new Map<string, WorklogBoundGroup>();
  boundMembers = new Map<string, boolean>();
  workspaceEnsureCalls: number[] = [];
  promoteCalls: Array<Parameters<WorklogBootstrapRepository['promoteGroup']>[0]> = [];
  ensureGroupCalls: Array<{ lineGroupId: string; workspaceId: number }> = [];

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

  async ensureGroupSource(lineGroupId: string, workspaceId: number) {
    this.ensureGroupCalls.push({ lineGroupId, workspaceId });
    const existing = this.boundGroups.get(lineGroupId);
    if (existing) {
      const active = { ...existing, status: 'ACTIVE' as const };
      this.boundGroups.set(lineGroupId, active);
      return active;
    }
    const created: WorklogBoundGroup = {
      sourceId: this.nextSourceId++,
      lineGroupId,
      workspaceId,
      ownerUserId: null,
      status: 'ACTIVE',
    };
    this.boundGroups.set(lineGroupId, created);
    return created;
  }

  async reactivateBoundGroup(sourceId: number) {
    for (const [lineGroupId, group] of this.boundGroups) {
      if (group.sourceId === sourceId) {
        this.boundGroups.set(lineGroupId, { ...group, status: 'ACTIVE' });
        return true;
      }
    }
    return false;
  }

  async upsertBoundGroupMember(sourceId: number, userId: number, isActive: boolean) {
    this.boundMembers.set(`${sourceId}:${userId}`, isActive);
  }

  async markGroupInactive(lineGroupId: string) {
    const bound = this.boundGroups.get(lineGroupId);
    if (bound) this.boundGroups.set(lineGroupId, { ...bound, status: 'INACTIVE' });
  }

  async promoteGroup(input: Parameters<WorklogBootstrapRepository['promoteGroup']>[0]) {
    this.promoteCalls.push(input);
    const existing = this.boundGroups.get(input.lineGroupId);
    if (existing && existing.ownerUserId !== null && existing.ownerUserId !== input.ownerUserId) return null;
    const source: WorklogBoundGroup = existing ?? {
      sourceId: this.nextSourceId++,
      lineGroupId: input.lineGroupId,
      workspaceId: input.workspaceId,
      ownerUserId: null,
      status: 'ACTIVE',
    };
    const promoted: WorklogBoundGroup = {
      ...source,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      status: 'ACTIVE',
    };
    this.boundGroups.set(input.lineGroupId, promoted);
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

  it('reuses the stable personal source for an active OA friend interaction', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    const followed = await service.handleOaFollow({ lineUserId: 'U1' });

    const interaction = await service.bootstrapPrivateInteraction({
      lineUserId: 'U1',
      at: new Date('2026-09-02T01:00:00Z'),
    });

    expect(interaction).toEqual({
      status: 'READY',
      userId: followed.userId,
      workspaceId: followed.workspaceId,
      sourceId: followed.sourceId,
    });
    expect(repository.privateSources.size).toBe(1);
  });

  it('does not recreate a personal source after unfollow until friendship is active again', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    await service.handleOaFollow({ lineUserId: 'U1' });
    await service.handleOaUnfollow({ lineUserId: 'U1' });
    const workspaceCallsBefore = repository.workspaceEnsureCalls.length;

    const interaction = await service.bootstrapPrivateInteraction({ lineUserId: 'U1' });

    expect(interaction).toEqual({ status: 'NOT_OA_FRIEND', userId: 1 });
    expect(repository.workspaceEnsureCalls).toHaveLength(workspaceCallsBefore);
    expect(repository.privateSources.size).toBe(1);
  });
});

describe('group bootstrap', () => {
  it('creates a durable active group Source immediately without assigning an AI responsible user', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const result = await service.bootstrapGroupInteraction({
      lineGroupId: 'C1',
      lineUserId: 'U2',
      at: new Date('2026-09-02T01:00:00Z'),
    });

    expect(result).toMatchObject({ status: 'BOUND', userId: 1, ownerUserId: null });
    expect(repository.ensureGroupCalls).toHaveLength(1);
    expect(repository.promoteCalls).toEqual([]);
    expect(repository.boundMembers.get(`${result.sourceId}:1`)).toBe(true);
  });

  it('reuses the same unowned Source for later members instead of creating pending-group state', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const first = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER-1' });
    const second = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER-2' });

    expect(second.sourceId).toBe(first.sourceId);
    expect(second.ownerUserId).toBeNull();
    expect(repository.ensureGroupCalls).toHaveLength(1);
    expect(repository.boundMembers.get(`${first.sourceId}:1`)).toBe(true);
    expect(repository.boundMembers.get(`${first.sourceId}:2`)).toBe(true);
  });

  it('assigns AI responsibility later without changing Source identity', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const source = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER' });
    const result = await service.bindGroupOwner({
      lineGroupId: 'C1',
      ownerLineUserId: 'OWNER',
      evidence: 'EXPLICIT_CLAIM',
      at: new Date('2026-09-02T02:00:00Z'),
    });

    expect(result).toMatchObject({ status: 'BOUND', sourceId: source.sourceId, ownerUserId: 2 });
    expect(repository.promoteCalls[0]?.bindingMethod).toBe('EXPLICIT_CLAIM');
    expect(repository.boundMembers.get(`${source.sourceId}:1`)).toBe(true);
    expect(repository.boundMembers.get(`${source.sourceId}:2`)).toBe(true);
  });

  it('never reassigns an already-owned group to a different active responsible user', async () => {
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
    expect(repository.promoteCalls).toHaveLength(2);
  });

  it('reactivates a known member without changing recording permission semantics', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    const group = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'OWNER' });

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

    expect(repository.boundMembers.get(`${group.sourceId}:2`)).toBe(true);
  });

  it('reactivates the existing Source after a group leave without requiring an AI responsible user', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    const group = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER' });

    await service.handleGroupLeave({ lineGroupId: 'C1', at: new Date('2026-09-02T03:00:00Z') });
    expect(repository.boundGroups.get('C1')?.status).toBe('INACTIVE');

    const rejoined = await service.bootstrapGroupInteraction({
      lineGroupId: 'C1',
      lineUserId: 'MEMBER',
      at: new Date('2026-09-02T04:00:00Z'),
    });

    expect(rejoined).toEqual({
      status: 'BOUND',
      userId: 1,
      sourceId: group.sourceId,
      ownerUserId: null,
    });
    expect(repository.boundGroups.get('C1')?.status).toBe('ACTIVE');
  });
});
