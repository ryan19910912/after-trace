export type ManagedMemory = {
  id: number;
  category: string;
  subject: string | null;
  content: string;
  sourceMessageId: string | null;
  sourceLineUserId: string | null;
  sourceLineTimestamp: string | null;
  sourceQuoteToken: string | null;
  updatedAt: string;
};

export type ManagedReminder = {
  id: number;
  message: string;
  scheduledFor: string;
  status: 'SCHEDULED' | 'DISPATCHING' | 'CANCELLED' | 'DELIVERED';
};

export type ManagementOverview = {
  buckets: Record<'WELCOME' | 'AD' | 'PAID', { hasAvailable: boolean; hasReserved: boolean }>;
  aiUsageCount: number;
  rewardedAd: {
    grantCountToday: number;
    lastAcceptedAt: string | null;
  };
};

export type MemoryUpdateInput = {
  category: string;
  subject: string | null;
  content: string;
};

export interface ManagementRepository {
  listMemories(groupId: number, query: string | null, limit: number): Promise<ManagedMemory[]>;
  updateMemory(
    groupId: number,
    memoryId: number,
    actorLineUserId: string,
    input: MemoryUpdateInput,
    at: Date,
  ): Promise<'UPDATED' | 'NOT_FOUND'>;
  deleteMemory(
    groupId: number,
    memoryId: number,
    actorLineUserId: string,
    at: Date,
  ): Promise<'DELETED' | 'NOT_FOUND'>;
  overview(groupId: number, policyDay: string): Promise<ManagementOverview>;
  listReminders(groupId: number, limit: number): Promise<ManagedReminder[]>;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function bounded(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${name} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function normalizedSubject(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 500) throw new Error('subject must contain at most 500 characters');
  return normalized;
}

export class ManagementService {
  constructor(private readonly repository: ManagementRepository) {}

  listMemories(groupId: number, query?: string | null, limit = 100): Promise<ManagedMemory[]> {
    positiveSafeInteger(groupId, 'groupId');
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 200) {
      throw new Error('limit must be an integer between 1 and 200');
    }
    const normalizedQuery = query?.trim() || null;
    if (normalizedQuery && normalizedQuery.length > 200) {
      throw new Error('query must contain at most 200 characters');
    }
    return this.repository.listMemories(groupId, normalizedQuery, limit);
  }

  updateMemory(
    groupId: number,
    memoryId: number,
    actorLineUserId: string,
    input: MemoryUpdateInput,
    at = new Date(),
  ) {
    const category = bounded(input.category, 'category', 64);
    const content = bounded(input.content, 'content', 10_000);
    return this.repository.updateMemory(
      positiveSafeInteger(groupId, 'groupId'),
      positiveSafeInteger(memoryId, 'memoryId'),
      bounded(actorLineUserId, 'actorLineUserId', 64),
      { category, subject: normalizedSubject(input.subject), content },
      at,
    );
  }

  deleteMemory(groupId: number, memoryId: number, actorLineUserId: string, at = new Date()) {
    return this.repository.deleteMemory(
      positiveSafeInteger(groupId, 'groupId'),
      positiveSafeInteger(memoryId, 'memoryId'),
      bounded(actorLineUserId, 'actorLineUserId', 64),
      at,
    );
  }

  overview(groupId: number, policyDay: string): Promise<ManagementOverview> {
    return this.repository.overview(
      positiveSafeInteger(groupId, 'groupId'),
      bounded(policyDay, 'policyDay', 10),
    );
  }

  listReminders(groupId: number, limit = 100): Promise<ManagedReminder[]> {
    positiveSafeInteger(groupId, 'groupId');
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 200) {
      throw new Error('limit must be an integer between 1 and 200');
    }
    return this.repository.listReminders(groupId, limit);
  }
}
