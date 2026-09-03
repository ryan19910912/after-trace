import { describe, expect, it } from 'vitest';
import {
  WorklogAiGrantService,
  type WorklogAiGrantRepository,
  type WorklogAiGrantSnapshot,
} from './ai-grants';
import { FREE_INITIAL_AI_POINTS, FREE_INITIAL_GRANT_ORIGIN_KEY } from './ai-points';

class FakeRepository implements WorklogAiGrantRepository {
  calls: Array<{ kind: string; input: unknown }> = [];
  grant: WorklogAiGrantSnapshot = {
    id: 10,
    ownerUserId: 7,
    type: 'FREE_INITIAL',
    status: 'ACTIVE',
    originalPoints: FREE_INITIAL_AI_POINTS,
    remainingPoints: FREE_INITIAL_AI_POINTS,
    effectiveAt: new Date('2026-09-04T00:00:00.000Z'),
    expiresAt: null,
    originKey: FREE_INITIAL_GRANT_ORIGIN_KEY,
  };
  totalRemainingPoints = FREE_INITIAL_AI_POINTS;

  async ensureGrant(input: Parameters<WorklogAiGrantRepository['ensureGrant']>[0]) {
    this.calls.push({ kind: 'grant', input });
    return this.grant;
  }

  async ensureScope(input: Parameters<WorklogAiGrantRepository['ensureScope']>[0]) {
    this.calls.push({ kind: 'scope', input });
  }

  async eligibleBalance(input: Parameters<WorklogAiGrantRepository['eligibleBalance']>[0]) {
    this.calls.push({ kind: 'balance', input });
    return {
      ownerUserId: input.ownerUserId,
      sourceId: input.sourceId,
      totalRemainingPoints: this.totalRemainingPoints,
      grants: [],
    };
  }
}

describe('WorklogAiGrantService', () => {
  it('provisions exactly one frozen FREE launch grant definition and PRIVATE scope', async () => {
    const repository = new FakeRepository();
    const service = new WorklogAiGrantService(repository);
    const at = new Date('2026-09-04T00:00:00.000Z');

    await service.ensureInitialFreeGrant({ userId: 7, privateSourceId: 12, at });

    expect(repository.calls[0]).toEqual({
      kind: 'grant',
      input: {
        ownerUserId: 7,
        type: 'FREE_INITIAL',
        originalPoints: 400_000,
        effectiveAt: at,
        expiresAt: null,
        originKey: FREE_INITIAL_GRANT_ORIGIN_KEY,
        metadata: { launchPolicy: 'MVP_2026_09' },
      },
    });
    expect(repository.calls[1]).toEqual({
      kind: 'scope',
      input: { grantId: 10, sourceId: 12, capPoints: null, at },
    });
  });

  it('requires positive scoped balance before AI can start', async () => {
    const repository = new FakeRepository();
    const service = new WorklogAiGrantService(repository);

    expect(await service.canStartAi(7, 12)).toBe(true);
    repository.totalRemainingPoints = 0;
    expect(await service.canStartAi(7, 12)).toBe(false);
  });
});
