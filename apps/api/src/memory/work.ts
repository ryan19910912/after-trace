export type MemoryRequestOrigin = 'EXPLICIT' | 'AUTOMATIC';

export type AutomaticMemoryRequest = {
  id: number;
  groupId: number;
  extractionBatchId: number;
  status: 'PENDING' | 'CLAIMED' | 'SUCCEEDED' | 'FAILED';
  created: boolean;
};

export interface AutomaticMemoryRequestRepository {
  createAutomatic(input: {
    groupId: number;
    extractionBatchId: number;
    createdAt: Date;
  }): Promise<AutomaticMemoryRequest>;
}

export type ClaimedMemoryRequest = {
  id: number;
  groupId: number;
  origin: MemoryRequestOrigin;
  extractionBatchId: number | null;
  actorLineUserId: string | null;
  sourceConversationMessageId: number | null;
  instruction: string | null;
  attemptCount: number;
  leaseExpiresAt: Date;
};

export interface MemoryWorkRepository {
  claimNextForGroup(
    groupId: number,
    now: Date,
    leaseUntil: Date,
  ): Promise<ClaimedMemoryRequest | null>;
  markSucceeded(
    requestId: number,
    attemptCount: number,
    completedAt: Date,
  ): Promise<boolean>;
  deferFailure(
    requestId: number,
    attemptCount: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<boolean>;
}

export class AutomaticMemoryRequestService {
  constructor(private readonly repository: AutomaticMemoryRequestRepository) {}

  ensureForExtractionBatch(
    groupId: number,
    extractionBatchId: number,
    createdAt = new Date(),
  ): Promise<AutomaticMemoryRequest> {
    assertPositiveSafeInteger(groupId, 'groupId');
    assertPositiveSafeInteger(extractionBatchId, 'extractionBatchId');
    return this.repository.createAutomatic({ groupId, extractionBatchId, createdAt });
  }
}

export class MemoryWorkCoordinator {
  constructor(
    private readonly repository: MemoryWorkRepository,
    private readonly leaseSeconds: number,
  ) {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
      throw new Error('memory request leaseSeconds must be a positive safe integer');
    }
  }

  claimNextForGroup(groupId: number, now = new Date()): Promise<ClaimedMemoryRequest | null> {
    assertPositiveSafeInteger(groupId, 'groupId');
    const leaseUntil = new Date(now.getTime() + this.leaseSeconds * 1_000);
    return this.repository.claimNextForGroup(groupId, now, leaseUntil);
  }

  markSucceeded(
    requestId: number,
    attemptCount: number,
    completedAt = new Date(),
  ): Promise<boolean> {
    assertClaimFence(requestId, attemptCount);
    return this.repository.markSucceeded(requestId, attemptCount, completedAt);
  }

  deferFailure(
    requestId: number,
    attemptCount: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<boolean> {
    assertClaimFence(requestId, attemptCount);
    const normalized = errorCode.trim().slice(0, 128) || 'UNKNOWN';
    return this.repository.deferFailure(requestId, attemptCount, retryAt, normalized);
  }
}

function assertClaimFence(requestId: number, attemptCount: number): void {
  assertPositiveSafeInteger(requestId, 'requestId');
  assertPositiveSafeInteger(attemptCount, 'attemptCount');
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
