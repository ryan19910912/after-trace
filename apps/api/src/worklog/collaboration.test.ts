import { describe, expect, it } from 'vitest';
import {
  WorklogCollaborationService,
  type GroupManualAccessContext,
  type WorklogCollaborationRepository,
} from './collaboration';

class FakeRepository implements WorklogCollaborationRepository {
  context: GroupManualAccessContext | null = null;
  calls: Array<{ sourceId: number; actorUserId: number }> = [];

  async getGroupManualAccessContext(sourceId: number, actorUserId: number) {
    this.calls.push({ sourceId, actorUserId });
    return this.context;
  }
}

function activeContext(overrides: Partial<GroupManualAccessContext> = {}): GroupManualAccessContext {
  return {
    sourceId: 10,
    sourceStatus: 'ACTIVE',
    actorIsActiveMember: true,
    ...overrides,
  };
}

describe('WorklogCollaborationService', () => {
  it('allows free manual GROUP access for an active member without subscription, Owner or AI checks', async () => {
    const repository = new FakeRepository();
    repository.context = activeContext();
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200 }))
      .resolves.toEqual({ status: 'OK', actorUserId: 200 });
    expect(repository.calls).toEqual([{ sourceId: 10, actorUserId: 200 }]);
  });

  it('rejects a non-member regardless of any external funding state', async () => {
    const repository = new FakeRepository();
    repository.context = activeContext({ actorIsActiveMember: false });
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200 }))
      .resolves.toEqual({ status: 'NOT_ACTIVE_MEMBER' });
  });

  it('rejects inactive GROUP Sources', async () => {
    const repository = new FakeRepository();
    repository.context = activeContext({ sourceStatus: 'INACTIVE' });
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200 }))
      .resolves.toEqual({ status: 'GROUP_INACTIVE' });
  });

  it('rejects missing GROUP Sources', async () => {
    const repository = new FakeRepository();
    const service = new WorklogCollaborationService(repository);

    await expect(service.authorizeGroupAccess({ sourceId: 10, actorUserId: 200 }))
      .resolves.toEqual({ status: 'GROUP_NOT_FOUND' });
  });
});
