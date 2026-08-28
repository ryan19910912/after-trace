import { describe, expect, it, vi } from 'vitest';
import {
  AutomaticMemoryRequestService,
  MemoryWorkCoordinator,
  type MemoryWorkRepository,
} from './work';

describe('AutomaticMemoryRequestService', () => {
  it('uses extraction batch identity as the automatic request boundary', async () => {
    const createAutomatic = vi.fn(async () => ({
      id: 8,
      groupId: 3,
      extractionBatchId: 21,
      status: 'PENDING' as const,
      created: true,
    }));
    const service = new AutomaticMemoryRequestService({ createAutomatic });
    const at = new Date('2026-08-29T00:00:00Z');

    await service.ensureForExtractionBatch(3, 21, at);

    expect(createAutomatic).toHaveBeenCalledWith({
      groupId: 3,
      extractionBatchId: 21,
      createdAt: at,
    });
  });
});

describe('MemoryWorkCoordinator', () => {
  it('creates a bounded lease and delegates ownership to the repository', async () => {
    const now = new Date('2026-08-29T00:00:00Z');
    const claimNextForGroup = vi.fn(async (_groupId: number, _now: Date, leaseUntil: Date) => ({
      id: 4,
      groupId: 3,
      origin: 'EXPLICIT' as const,
      extractionBatchId: null,
      actorLineUserId: 'U1',
      sourceConversationMessageId: 10,
      instruction: '記住這個',
      attemptCount: 2,
      leaseExpiresAt: leaseUntil,
    }));
    const repository: MemoryWorkRepository = {
      claimNextForGroup,
      markSucceeded: vi.fn(async () => true),
      deferFailure: vi.fn(async () => true),
    };
    const coordinator = new MemoryWorkCoordinator(repository, 90);

    const claim = await coordinator.claimNextForGroup(3, now);

    expect(claim?.attemptCount).toBe(2);
    expect(claimNextForGroup).toHaveBeenCalledWith(
      3,
      now,
      new Date('2026-08-29T00:01:30Z'),
    );
  });

  it('normalizes retry error codes while preserving the claim fence', async () => {
    const deferFailure = vi.fn(async () => true);
    const repository: MemoryWorkRepository = {
      claimNextForGroup: vi.fn(async () => null),
      markSucceeded: vi.fn(async () => true),
      deferFailure,
    };
    const coordinator = new MemoryWorkCoordinator(repository, 30);
    const retryAt = new Date('2026-08-29T00:02:00Z');

    await coordinator.deferFailure(7, 3, retryAt, '  GEMINI_TEMPORARY  ');

    expect(deferFailure).toHaveBeenCalledWith(7, 3, retryAt, 'GEMINI_TEMPORARY');
  });
});
