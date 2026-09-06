import { describe, expect, it } from 'vitest';
import {
  WorklogAiResponsibilityService,
  type WorklogAiResponsibilityRepository,
  type WorklogGroupAiContext,
} from './ai-responsibility';

class FakeRepository implements WorklogAiResponsibilityRepository {
  context: WorklogGroupAiContext | null = {
    sourceId: 20,
    sourceStatus: 'ACTIVE',
    actorIsActiveMember: true,
    responsibleUserId: 7,
    responsibleUserIsActiveMember: true,
  };
  releaseResult: Awaited<ReturnType<WorklogAiResponsibilityRepository['releaseIfResponsible']>> = 'RELEASED';
  releaseCalls: Array<{ sourceId: number; actorUserId: number; reason: string }> = [];

  async getGroupAiContext() { return this.context; }
  async assignIfUnbound() { return 'ASSIGNED' as const; }
  async releaseIfResponsible(input: { sourceId: number; actorUserId: number; reason: string }) {
    this.releaseCalls.push(input);
    return this.releaseResult;
  }
}

const grants = { canStartAi: async () => true };

describe('WorklogAiResponsibilityService release', () => {
  it('releases only through the repository owner-checked operation', async () => {
    const repository = new FakeRepository();
    const service = new WorklogAiResponsibilityService(repository, grants);
    await expect(service.release({ sourceId: 20, actorUserId: 7 })).resolves.toEqual({
      status: 'RELEASED',
      sourceId: 20,
      previousResponsibleUserId: 7,
    });
    expect(repository.releaseCalls[0]).toMatchObject({ sourceId: 20, actorUserId: 7, reason: 'EXPLICIT_RELEASE' });
  });

  it('does not treat another member as the responsible user', async () => {
    const repository = new FakeRepository();
    repository.releaseResult = 'NOT_RESPONSIBLE';
    const service = new WorklogAiResponsibilityService(repository, grants);
    await expect(service.release({ sourceId: 20, actorUserId: 9 })).resolves.toEqual({ status: 'NOT_RESPONSIBLE', sourceId: 20 });
  });

  it('preserves explicit unbound state', async () => {
    const repository = new FakeRepository();
    repository.releaseResult = 'UNBOUND';
    const service = new WorklogAiResponsibilityService(repository, grants);
    await expect(service.release({ sourceId: 20, actorUserId: 7 })).resolves.toEqual({ status: 'UNBOUND', sourceId: 20 });
  });
});
