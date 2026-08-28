export type MemoryDecision = 'NEW' | 'DUPLICATE' | 'UPDATE' | 'CONTRADICT';

export type ActiveMemory = {
  id: number;
  category: string;
  subject: string | null;
  content: string;
  sourceMessageId: string | null;
  sourceLineUserId: string | null;
  sourceLineTimestamp: Date | null;
};

export type ClassifiedMemoryCandidate = {
  candidateIndex: number;
  decision: MemoryDecision;
  targetMemoryId: number | null;
  category: string;
  subject: string | null;
  content: string;
  sourceConversationMessageId: number;
};

export type PersistedMemoryCandidate = {
  resultId: number;
  requestId: number;
  candidateIndex: number;
  decision: MemoryDecision;
  memoryId: number;
  targetMemoryId: number | null;
  idempotent: boolean;
};

export interface MemoryCandidateRepository {
  listActiveMemories(groupId: number): Promise<ActiveMemory[]>;
  persistClassifiedCandidate(input: {
    requestId: number;
    groupId: number;
    claimAttemptCount: number;
    actorLineUserId: string | null;
    candidate: ClassifiedMemoryCandidate;
    createdAt: Date;
  }): Promise<PersistedMemoryCandidate>;
}

export class MemoryCandidatePipeline {
  constructor(private readonly repository: MemoryCandidateRepository) {}

  listActiveMemories(groupId: number): Promise<ActiveMemory[]> {
    assertPositiveSafeInteger(groupId, 'groupId');
    return this.repository.listActiveMemories(groupId);
  }

  persist(
    input: {
      requestId: number;
      groupId: number;
      claimAttemptCount: number;
      actorLineUserId: string | null;
      candidate: ClassifiedMemoryCandidate;
    },
    createdAt = new Date(),
  ): Promise<PersistedMemoryCandidate> {
    assertPositiveSafeInteger(input.requestId, 'requestId');
    assertPositiveSafeInteger(input.groupId, 'groupId');
    assertPositiveSafeInteger(input.claimAttemptCount, 'claimAttemptCount');
    validateCandidate(input.candidate);

    return this.repository.persistClassifiedCandidate({
      ...input,
      candidate: normalizeCandidate(input.candidate),
      createdAt,
    });
  }
}

function validateCandidate(candidate: ClassifiedMemoryCandidate): void {
  if (!Number.isSafeInteger(candidate.candidateIndex) || candidate.candidateIndex < 0) {
    throw new Error('candidateIndex must be a non-negative safe integer');
  }
  assertPositiveSafeInteger(candidate.sourceConversationMessageId, 'sourceConversationMessageId');

  if (!candidate.category.trim()) throw new Error('memory category is required');
  if (!candidate.content.trim()) throw new Error('memory content is required');

  if (candidate.decision === 'NEW') {
    if (candidate.targetMemoryId !== null) {
      throw new Error('NEW memory candidate must not target an existing memory');
    }
    return;
  }

  if (candidate.targetMemoryId === null) {
    throw new Error(`${candidate.decision} memory candidate must target an active memory`);
  }
  assertPositiveSafeInteger(candidate.targetMemoryId, 'targetMemoryId');
}

function normalizeCandidate(candidate: ClassifiedMemoryCandidate): ClassifiedMemoryCandidate {
  return {
    ...candidate,
    category: candidate.category.trim().slice(0, 64),
    subject: candidate.subject?.trim() || null,
    content: candidate.content.trim(),
  };
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
