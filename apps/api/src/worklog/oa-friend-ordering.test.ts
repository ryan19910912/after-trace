import { describe, expect, it } from 'vitest';
import {
  WorklogBootstrapService,
  type WorklogBootstrapRepository,
  type WorklogBootstrapUser,
  type WorklogBoundGroup,
  type WorklogPendingGroup,
} from './bootstrap';

class OrderingRepository implements WorklogBootstrapRepository {
  private user: WorklogBootstrapUser | null = null;
  private lastInteractionAt: Date | null = null;
  private friendStateAt: Date | null = null;

  async upsertLineUser(input: Parameters<WorklogBootstrapRepository['upsertLineUser']>[0]) {
    if (!this.user) {
      this.user = { userId: 1, lineUserId: input.lineUserId, isOaFriend: false };
    }
    if (!this.lastInteractionAt || input.at >= this.lastInteractionAt) this.lastInteractionAt = input.at;
    return { ...this.user };
  }

  async setOaFriendState(_userId: number, isOaFriend: boolean, at: Date) {
    if (!this.friendStateAt || at >= this.friendStateAt) {
      this.friendStateAt = at;
      if (this.user) this.user = { ...this.user, isOaFriend };
    }
  }

  currentFriendState() { return this.user?.isOaFriend ?? false; }
  currentFriendStateAt() { return this.friendStateAt; }

  async ensureWorkspace() { return 100; }
  async ensurePrivateSource() { return 1000; }
  async findBoundGroupByLineId(): Promise<WorklogBoundGroup | null> { return null; }
  async reactivateBoundGroup() { return false; }
  async upsertPendingGroup(): Promise<WorklogPendingGroup> { throw new Error('unused'); }
  async upsertPendingGroupMember() {}
  async upsertBoundGroupMember() {}
  async markGroupInactive() {}
  async promoteGroup(): Promise<WorklogBoundGroup | null> { return null; }
}

describe('OA friendship lifecycle ordering', () => {
  it('does not let an older delayed unfollow overwrite a newer follow', async () => {
    const repository = new OrderingRepository();
    const service = new WorklogBootstrapService(repository);

    await service.handleOaFollow({ lineUserId: 'U1', at: new Date('2026-09-02T12:00:00Z') });
    await service.handleOaUnfollow({ lineUserId: 'U1', at: new Date('2026-09-02T11:00:00Z') });

    expect(repository.currentFriendState()).toBe(true);
    expect(repository.currentFriendStateAt()?.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });

  it('still accepts a follow event that predates a later ordinary interaction delivered first', async () => {
    const repository = new OrderingRepository();
    const service = new WorklogBootstrapService(repository);

    await service.touchPrivateInteraction({ lineUserId: 'U1', at: new Date('2026-09-02T12:01:00Z') });
    await service.handleOaFollow({ lineUserId: 'U1', at: new Date('2026-09-02T12:00:00Z') });

    expect(repository.currentFriendState()).toBe(true);
    expect(repository.currentFriendStateAt()?.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });
});
