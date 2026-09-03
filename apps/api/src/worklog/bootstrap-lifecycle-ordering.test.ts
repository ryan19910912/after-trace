import { describe, expect, it } from 'vitest';
import {
  WorklogBootstrapService,
  type WorklogBootstrapRepository,
  type WorklogBootstrapUser,
  type WorklogBoundGroup,
} from './bootstrap';

class OrderingRepository implements WorklogBootstrapRepository {
  user: WorklogBootstrapUser = { userId: 1, lineUserId: 'U1', isOaFriend: false };
  group: WorklogBoundGroup = {
    sourceId: 10,
    lineGroupId: 'C1',
    workspaceId: 20,
    ownerUserId: null,
    status: 'ACTIVE',
  };
  groupEventAt = new Date('2026-09-02T10:00:00.000Z');
  memberActive = true;
  memberEventAt = new Date('2026-09-02T10:00:00.000Z');

  async upsertLineUser(): Promise<WorklogBootstrapUser> { return this.user; }
  async setOaFriendState(): Promise<void> {}
  async ensureWorkspace(): Promise<number> { return 20; }
  async ensurePrivateSource(): Promise<number> { return 30; }
  async findBoundGroupByLineId(lineGroupId: string): Promise<WorklogBoundGroup | null> {
    return lineGroupId === this.group.lineGroupId ? this.group : null;
  }
  async ensureGroupSource(): Promise<WorklogBoundGroup> { return this.group; }
  async reactivateBoundGroup(sourceId: number, at: Date): Promise<boolean> {
    if (sourceId !== this.group.sourceId || at < this.groupEventAt) return false;
    this.groupEventAt = at;
    this.group = { ...this.group, status: 'ACTIVE' };
    return true;
  }
  async upsertBoundGroupMember(_sourceId: number, _userId: number, isActive: boolean, at: Date): Promise<void> {
    if (at < this.memberEventAt) return;
    this.memberEventAt = at;
    this.memberActive = isActive;
  }
  async markGroupInactive(lineGroupId: string, at: Date): Promise<void> {
    if (lineGroupId !== this.group.lineGroupId || at < this.groupEventAt) return;
    this.groupEventAt = at;
    this.group = { ...this.group, status: 'INACTIVE' };
    if (at >= this.memberEventAt) {
      this.memberEventAt = at;
      this.memberActive = false;
    }
  }
  async promoteGroup(): Promise<WorklogBoundGroup | null> { return this.group; }
}

describe('LINE lifecycle ordering', () => {
  it('does not let an older delayed LEAVE deactivate a group after a newer rejoin interaction', async () => {
    const repository = new OrderingRepository();
    const service = new WorklogBootstrapService(repository);

    await service.handleGroupLeave({ lineGroupId: 'C1', at: new Date('2026-09-02T11:00:00.000Z') });
    expect(repository.group.status).toBe('INACTIVE');

    await service.bootstrapGroupInteraction({
      lineGroupId: 'C1',
      lineUserId: 'U1',
      at: new Date('2026-09-02T12:00:00.000Z'),
    });
    expect(repository.group.status).toBe('ACTIVE');

    await service.handleGroupLeave({ lineGroupId: 'C1', at: new Date('2026-09-02T11:30:00.000Z') });
    expect(repository.group.status).toBe('ACTIVE');
  });

  it('does not let an older member-left event override a newer member-joined event', async () => {
    const repository = new OrderingRepository();
    const service = new WorklogBootstrapService(repository);

    await service.setGroupMemberPresence({
      lineGroupId: 'C1', lineUserId: 'U1', isActive: true,
      at: new Date('2026-09-02T12:00:00.000Z'),
    });
    await service.setGroupMemberPresence({
      lineGroupId: 'C1', lineUserId: 'U1', isActive: false,
      at: new Date('2026-09-02T11:30:00.000Z'),
    });

    expect(repository.memberActive).toBe(true);
    expect(repository.memberEventAt.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });
});
