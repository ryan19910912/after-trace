import { describe, expect, it } from 'vitest';
import {
  WorklogUsageService,
  emptyRecordTypeCounts,
  type ActiveUsageWindow,
  type AiUsageAggregate,
  type GroupMemberUsage,
  type RecordTypeCounts,
  type WorklogUsageRepository,
} from './usage';

class FakeRepository implements WorklogUsageRepository {
  windows = new Map<number, ActiveUsageWindow>();
  owners = new Map<number, number | null>();
  ai = new Map<string, AiUsageAggregate>();
  records = new Map<string, RecordTypeCounts>();
  members = new Map<number, GroupMemberUsage[]>();
  aiQueries = 0;

  async getActiveUsageWindow(userId: number) {
    return this.windows.get(userId) ?? null;
  }

  async sumChargedAiUsage(
    chargedUserId: number,
    _periodStart: Date | null,
    _periodEnd: Date | null,
    sourceId?: number,
  ) {
    this.aiQueries += 1;
    return this.ai.get(`${chargedUserId}:${sourceId ?? 'all'}`) ?? {
      aiUnits: 0,
      providerCostUsd: 0,
      providerCostTwd: 0,
    };
  }

  async countRecordsByAuthor(userId: number, sourceId?: number) {
    return this.records.get(`${userId}:${sourceId ?? 'all'}`) ?? emptyRecordTypeCounts();
  }

  async getGroupOwnerUserId(sourceId: number) {
    return this.owners.get(sourceId) ?? null;
  }

  async listGroupMemberUsage(sourceId: number) {
    return this.members.get(sourceId) ?? [];
  }
}

const cycle: ActiveUsageWindow = {
  planCode: 'SUB1',
  allowanceUnits: 100,
  reservedUnits: 5,
  periodStart: new Date('2026-09-01T00:00:00.000Z'),
  periodEnd: new Date('2026-10-01T00:00:00.000Z'),
};

describe('WorklogUsageService user usage', () => {
  it('returns current AI allowance, committed usage, reserved units, balance, cost, and record counts', async () => {
    const repository = new FakeRepository();
    repository.windows.set(100, cycle);
    repository.ai.set('100:all', {
      aiUnits: 42,
      providerCostUsd: 0.31,
      providerCostTwd: 9.75,
    });
    repository.records.set('100:all', { TEXT: 8, AUDIO: 2, IMAGE: 3, FILE: 1 });

    const service = new WorklogUsageService(repository);
    await expect(service.userUsage(100)).resolves.toEqual({
      userId: 100,
      planCode: 'SUB1',
      aiAllowanceUnits: 100,
      aiUsedUnits: 42,
      aiReservedUnits: 5,
      aiRemainingUnits: 53,
      providerCostUsd: 0.31,
      providerCostTwd: 9.75,
      records: { TEXT: 8, AUDIO: 2, IMAGE: 3, FILE: 1 },
    });
  });

  it('does not relabel lifetime AI usage as FREE current-cycle usage when no active window exists', async () => {
    const repository = new FakeRepository();
    repository.ai.set('100:all', { aiUnits: 999, providerCostUsd: 9, providerCostTwd: 280 });
    repository.records.set('100:all', { TEXT: 12, AUDIO: 1, IMAGE: 0, FILE: 2 });

    const service = new WorklogUsageService(repository);
    await expect(service.userUsage(100)).resolves.toEqual({
      userId: 100,
      planCode: 'FREE',
      aiAllowanceUnits: 0,
      aiUsedUnits: 0,
      aiReservedUnits: 0,
      aiRemainingUnits: 0,
      providerCostUsd: 0,
      providerCostTwd: 0,
      records: { TEXT: 12, AUDIO: 1, IMAGE: 0, FILE: 2 },
    });
    expect(repository.aiQueries).toBe(0);
  });
});

describe('WorklogUsageService group owner usage', () => {
  it('shows owner balance, group burn, and per-member actor usage without charging members', async () => {
    const repository = new FakeRepository();
    repository.owners.set(10, 100);
    repository.windows.set(100, cycle);
    repository.ai.set('100:all', {
      aiUnits: 60,
      providerCostUsd: 0.6,
      providerCostTwd: 18,
    });
    repository.ai.set('100:10', {
      aiUnits: 35,
      providerCostUsd: 0.35,
      providerCostTwd: 10.5,
    });
    repository.records.set('100:all', { TEXT: 2, AUDIO: 0, IMAGE: 1, FILE: 0 });
    repository.members.set(10, [
      {
        userId: 100,
        displayName: 'Owner',
        recordingEnabled: true,
        aiUsedUnits: 5,
        providerCostUsd: 0.05,
        providerCostTwd: 1.5,
        records: { TEXT: 2, AUDIO: 0, IMAGE: 1, FILE: 0 },
        lastInteractionAt: '2026-09-02T00:00:00.000Z',
        updatedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        userId: 200,
        displayName: 'Worker',
        recordingEnabled: false,
        aiUsedUnits: 30,
        providerCostUsd: 0.3,
        providerCostTwd: 9,
        records: { TEXT: 10, AUDIO: 4, IMAGE: 6, FILE: 1 },
        lastInteractionAt: '2026-09-02T00:10:00.000Z',
        updatedAt: '2026-09-02T00:10:00.000Z',
      },
    ]);

    const service = new WorklogUsageService(repository);
    await expect(service.groupOwnerUsage(100, 10)).resolves.toEqual({
      status: 'OK',
      value: {
        sourceId: 10,
        ownerUserId: 100,
        owner: {
          userId: 100,
          planCode: 'SUB1',
          aiAllowanceUnits: 100,
          aiUsedUnits: 60,
          aiReservedUnits: 5,
          aiRemainingUnits: 35,
          providerCostUsd: 0.6,
          providerCostTwd: 18,
          records: { TEXT: 2, AUDIO: 0, IMAGE: 1, FILE: 0 },
        },
        groupAiUsedUnits: 35,
        groupProviderCostUsd: 0.35,
        groupProviderCostTwd: 10.5,
        members: repository.members.get(10),
      },
    });
  });

  it('keeps historical member record counts but zeros cycle AI metrics after the owner has no active usage window', async () => {
    const repository = new FakeRepository();
    repository.owners.set(10, 100);
    repository.records.set('100:all', { TEXT: 3, AUDIO: 0, IMAGE: 0, FILE: 0 });
    repository.ai.set('100:all', { aiUnits: 50, providerCostUsd: 0.5, providerCostTwd: 15 });
    repository.ai.set('100:10', { aiUnits: 40, providerCostUsd: 0.4, providerCostTwd: 12 });
    repository.members.set(10, [{
      userId: 200,
      displayName: 'Worker',
      recordingEnabled: true,
      aiUsedUnits: 40,
      providerCostUsd: 0.4,
      providerCostTwd: 12,
      records: { TEXT: 7, AUDIO: 1, IMAGE: 2, FILE: 0 },
      lastInteractionAt: null,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }]);

    const service = new WorklogUsageService(repository);
    const result = await service.groupOwnerUsage(100, 10);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') throw new Error('expected OK');
    expect(result.value.owner.aiUsedUnits).toBe(0);
    expect(result.value.groupAiUsedUnits).toBe(0);
    expect(result.value.members[0]).toMatchObject({
      aiUsedUnits: 0,
      providerCostUsd: 0,
      providerCostTwd: 0,
      records: { TEXT: 7, AUDIO: 1, IMAGE: 2, FILE: 0 },
    });
    expect(repository.aiQueries).toBe(0);
  });

  it('does not expose owner/member usage to a non-owner', async () => {
    const repository = new FakeRepository();
    repository.owners.set(10, 100);
    const service = new WorklogUsageService(repository);

    await expect(service.groupOwnerUsage(200, 10)).resolves.toEqual({ status: 'FORBIDDEN' });
  });
});
