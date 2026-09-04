import { describe, expect, it } from 'vitest';
import {
  WorklogBootstrapService,
  type WorklogAiResponsibilityClaimPort,
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

  async ensureWorkspace(userId: number) {
    this.workspaceEnsureCalls.push(userId);
    const existing = this.workspaces.get(userId);
    if (existing) return existing;
    const id = this.nextWorkspaceId++;
    this.workspaces.set(userId, id);
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
}

class FakeAiResponsibility implements WorklogAiResponsibilityClaimPort {
  responsibleBySource = new Map<number, number>();
  claims: Array<{ sourceId: number; actorUserId: number; reason?: string }> = [];

  async claim(input: Parameters<WorklogAiResponsibilityClaimPort['claim']>[0]) {
    this.claims.push({
      sourceId: input.sourceId,
      actorUserId: input.actorUserId,
      reason: input.reason,
    });
    const existing = this.responsibleBySource.get(input.sourceId);
    if (existing === undefined) {
      this.responsibleBySource.set(input.sourceId, input.actorUserId);
      return { status: 'BOUND' as const, sourceId: input.sourceId, responsibleUserId: input.actorUserId };
    }
    if (existing === input.actorUserId) {
      return { status: 'ALREADY_BOUND' as const, sourceId: input.sourceId, responsibleUserId: existing };
    }
    return { status: 'CONFLICT' as const, sourceId: input.sourceId };
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
  it('creates a durable active group Source immediately without assigning AI responsibility', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const result = await service.bootstrapGroupInteraction({
      lineGroupId: 'C1',
      lineUserId: 'U2',
      at: new Date('2026-09-02T01:00:00Z'),
    });

    expect(result).toEqual({ status: 'BOUND', userId: 1, sourceId: 1000 });
    expect(repository.ensureGroupCalls).toHaveLength(1);
    expect(repository.boundMembers.get(`${result.sourceId}:1`)).toBe(true);
  });

  it('reuses the same Source for later members without pending-group or Owner state', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    const first = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER-1' });
    const second = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER-2' });

    expect(second.sourceId).toBe(first.sourceId);
    expect(repository.ensureGroupCalls).toHaveLength(1);
    expect(repository.boundMembers.get(`${first.sourceId}:1`)).toBe(true);
    expect(repository.boundMembers.get(`${first.sourceId}:2`)).toBe(true);
  });

  it('claims AI responsibility later without changing Source identity', async () => {
    const repository = new FakeRepository();
    const responsibility = new FakeAiResponsibility();
    const service = new WorklogBootstrapService(repository, undefined, responsibility);

    const source = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER' });
    const result = await service.claimGroupAiResponsibility({
      lineGroupId: 'C1',
      lineUserId: 'RESPONSIBLE',
      evidence: 'EXPLICIT_CLAIM',
      at: new Date('2026-09-02T02:00:00Z'),
    });

    expect(result).toEqual({ status: 'BOUND', sourceId: source.sourceId, responsibleUserId: 2 });
    expect(responsibility.claims).toEqual([{
      sourceId: source.sourceId,
      actorUserId: 2,
      reason: 'EXPLICIT_CLAIM',
    }]);
    expect(repository.boundMembers.get(`${source.sourceId}:1`)).toBe(true);
    expect(repository.boundMembers.get(`${source.sourceId}:2`)).toBe(true);
  });

  it('does not replace an existing AI responsible user with another claimant', async () => {
    const repository = new FakeRepository();
    const responsibility = new FakeAiResponsibility();
    const service = new WorklogBootstrapService(repository, undefined, responsibility);

    const first = await service.claimGroupAiResponsibility({
      lineGroupId: 'C1',
      lineUserId: 'RESPONSIBLE-1',
      evidence: 'RELIABLE_JOIN_ACTOR',
    });
    const second = await service.claimGroupAiResponsibility({
      lineGroupId: 'C1',
      lineUserId: 'RESPONSIBLE-2',
      evidence: 'EXPLICIT_CLAIM',
    });

    expect(first).toMatchObject({ status: 'BOUND', responsibleUserId: 1 });
    expect(second).toEqual({ status: 'RESPONSIBILITY_CONFLICT', sourceId: first.sourceId });
    expect(responsibility.responsibleBySource.get(first.sourceId)).toBe(1);
  });

  it('fails closed when AI responsibility infrastructure is not configured', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);

    await expect(service.claimGroupAiResponsibility({
      lineGroupId: 'C1',
      lineUserId: 'RESPONSIBLE',
      evidence: 'EXPLICIT_CLAIM',
    })).rejects.toThrow(/responsibility service is not configured/);
  });

  it('reactivates a known member without changing recording permission semantics', async () => {
    const repository = new FakeRepository();
    const service = new WorklogBootstrapService(repository);
    const group = await service.bootstrapGroupInteraction({ lineGroupId: 'C1', lineUserId: 'MEMBER-1' });

    await service.setGroupMemberPresence({ lineGroupId: 'C1', lineUserId: 'MEMBER-2', isActive: false });
    await service.setGroupMemberPresence({ lineGroupId: 'C1', lineUserId: 'MEMBER-2', isActive: true });

    expect(repository.boundMembers.get(`${group.sourceId}:2`)).toBe(true);
  });

  it('reactivates the existing Source after group leave without AI responsibility', async () => {
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

    expect(rejoined).toEqual({ status: 'BOUND', userId: 1, sourceId: group.sourceId });
    expect(repository.boundGroups.get('C1')?.status).toBe('ACTIVE');
  });
});
