import { describe, expect, it } from 'vitest';
import type {
  ManagedMemory,
  ManagedReminder,
  ManagementOverview,
  ManagementRepository,
  MemoryUpdateInput,
} from './service';
import { ManagementService } from './service';

class FakeRepository implements ManagementRepository {
  lastQuery: string | null = null;
  lastUpdate: MemoryUpdateInput | null = null;

  async listMemories(_groupId: number, query: string | null): Promise<ManagedMemory[]> {
    this.lastQuery = query;
    return [];
  }

  async updateMemory(
    _groupId: number,
    _memoryId: number,
    _actorLineUserId: string,
    input: MemoryUpdateInput,
  ): Promise<'UPDATED'> {
    this.lastUpdate = input;
    return 'UPDATED';
  }

  async deleteMemory(): Promise<'DELETED'> {
    return 'DELETED';
  }

  async overview(): Promise<ManagementOverview> {
    return {
      buckets: {
        WELCOME: { hasAvailable: false, hasReserved: false },
        AD: { hasAvailable: false, hasReserved: false },
        PAID: { hasAvailable: false, hasReserved: false },
      },
      aiUsageCount: 0,
      rewardedAd: { grantCountToday: 0, lastAcceptedAt: null },
    };
  }

  async listReminders(): Promise<ManagedReminder[]> {
    return [];
  }
}

describe('ManagementService', () => {
  it('normalizes memory search queries without inventing search semantics', async () => {
    const repository = new FakeRepository();
    const service = new ManagementService(repository);
    await service.listMemories(1, '  dinner  ');
    expect(repository.lastQuery).toBe('dinner');
  });

  it('normalizes optional memory subject and preserves explicit category/content', async () => {
    const repository = new FakeRepository();
    const service = new ManagementService(repository);
    await service.updateMemory(
      1,
      2,
      'U123',
      { category: ' FOOD ', subject: '   ', content: ' ramen ' },
      new Date('2026-08-29T00:00:00Z'),
    );
    expect(repository.lastUpdate).toEqual({
      category: 'FOOD',
      subject: null,
      content: 'ramen',
    });
  });

  it('rejects empty memory content before persistence', async () => {
    const service = new ManagementService(new FakeRepository());
    expect(() =>
      service.updateMemory(1, 2, 'U123', { category: 'FOOD', subject: null, content: ' ' }),
    ).toThrow('content must contain 1-10000 characters');
  });
});
