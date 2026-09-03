import { describe, expect, it } from 'vitest';
import {
  WorklogUsageService,
  type SourceAiFundingSnapshot,
  type SourceAiPointBalance,
  type SourceAiUsageAggregate,
  type WorklogUsageRepository,
} from './usage';

class FakeRepository implements WorklogUsageRepository {
  privateSources = new Map<number, number>();
  funding = new Map<number, SourceAiFundingSnapshot>();
  balances = new Map<string, SourceAiPointBalance>();
  usage = new Map<number, SourceAiUsageAggregate>();

  async getPrivateSourceId(userId: number) {
    return this.privateSources.get(userId) ?? null;
  }

  async getGroupAiFunding(sourceId: number) {
    return this.funding.get(sourceId) ?? {
      responsibleUserId: null,
      responsibleDisplayName: null,
    };
  }

  async getSourcePointBalance(input: { ownerUserId: number; sourceId: number; at: Date }) {
    return this.balances.get(`${input.ownerUserId}:${input.sourceId}`) ?? {
      availablePoints: 0,
      reservedPoints: 0,
    };
  }

  async sumSourceAiUsage(sourceId: number) {
    return this.usage.get(sourceId) ?? {
      customerPointsCharged: 0,
      platformSubsidizedPoints: 0,
    };
  }
}

describe('WorklogUsageService', () => {
  it('uses the current user and only PRIVATE-scoped grant balance for personal usage', async () => {
    const repository = new FakeRepository();
    repository.privateSources.set(100, 12);
    repository.balances.set('100:12', { availablePoints: 350_000, reservedPoints: 10_000 });
    repository.usage.set(12, { customerPointsCharged: 40_000, platformSubsidizedPoints: 500 });

    const service = new WorklogUsageService(repository);
    await expect(service.sourceUsage({
      viewerUserId: 100,
      sourceId: 12,
      scopeType: 'PRIVATE',
      at: new Date('2026-09-04T00:00:00.000Z'),
    })).resolves.toEqual({
      sourceId: 12,
      scopeType: 'PRIVATE',
      aiResponsibleUserId: 100,
      aiResponsibleDisplayName: null,
      aiAvailablePoints: 350_000,
      aiReservedPoints: 10_000,
      aiUsedPoints: 40_000,
      platformSubsidizedPoints: 500,
      canManageFunding: true,
    });
  });

  it('keeps the compatibility /usage/me shape backed by PRIVATE grants instead of aggregate quota', async () => {
    const repository = new FakeRepository();
    repository.privateSources.set(100, 12);
    repository.balances.set('100:12', { availablePoints: 350_000, reservedPoints: 10_000 });
    repository.usage.set(12, { customerPointsCharged: 40_000, platformSubsidizedPoints: 500 });

    const service = new WorklogUsageService(repository);
    await expect(service.userUsage(100)).resolves.toMatchObject({
      userId: 100,
      planCode: 'AI_POINTS',
      aiAllowanceUnits: 400_000,
      aiUsedUnits: 40_000,
      aiReservedUnits: 10_000,
      aiRemainingUnits: 350_000,
    });
  });

  it('shows only the responsible user balance explicitly scoped to a GROUP source', async () => {
    const repository = new FakeRepository();
    repository.funding.set(77, { responsibleUserId: 100, responsibleDisplayName: 'Amy' });
    repository.balances.set('100:77', { availablePoints: 80_000, reservedPoints: 5_000 });
    repository.usage.set(77, { customerPointsCharged: 20_000, platformSubsidizedPoints: 1_200 });

    const service = new WorklogUsageService(repository);
    await expect(service.sourceUsage({
      viewerUserId: 200,
      sourceId: 77,
      scopeType: 'GROUP',
    })).resolves.toEqual({
      sourceId: 77,
      scopeType: 'GROUP',
      aiResponsibleUserId: 100,
      aiResponsibleDisplayName: 'Amy',
      aiAvailablePoints: 80_000,
      aiReservedPoints: 5_000,
      aiUsedPoints: 20_000,
      platformSubsidizedPoints: 1_200,
      canManageFunding: false,
    });
  });

  it('does not expose another user balance when a GROUP has no AI 額度負責人', async () => {
    const repository = new FakeRepository();
    repository.usage.set(77, { customerPointsCharged: 20_000, platformSubsidizedPoints: 0 });

    const service = new WorklogUsageService(repository);
    await expect(service.sourceUsage({
      viewerUserId: 200,
      sourceId: 77,
      scopeType: 'GROUP',
    })).resolves.toEqual({
      sourceId: 77,
      scopeType: 'GROUP',
      aiResponsibleUserId: null,
      aiResponsibleDisplayName: null,
      aiAvailablePoints: 0,
      aiReservedPoints: 0,
      aiUsedPoints: 20_000,
      platformSubsidizedPoints: 0,
      canManageFunding: false,
    });
  });
});
