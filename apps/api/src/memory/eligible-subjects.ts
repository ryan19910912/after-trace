export type EligibleMemorySubject = {
  userId: number;
  lineUserId: string;
  normalizedCharCount: number;
  preflightAvailableUnits: bigint;
};

export interface EligibleMemorySubjectRepository {
  listForRequest(requestId: number): Promise<EligibleMemorySubject[]>;
}

export class EligibleMemorySubjectService {
  constructor(private readonly repository: EligibleMemorySubjectRepository) {}

  async listForRequest(requestId: number): Promise<EligibleMemorySubject[]> {
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      throw new Error('requestId must be a positive safe integer');
    }
    const subjects = await this.repository.listForRequest(requestId);
    const seen = new Set<number>();
    for (const subject of subjects) {
      if (!Number.isSafeInteger(subject.userId) || subject.userId <= 0) {
        throw new Error('eligible subject userId must be a positive safe integer');
      }
      if (!subject.lineUserId.trim()) throw new Error('eligible subject lineUserId is required');
      if (!Number.isSafeInteger(subject.normalizedCharCount) || subject.normalizedCharCount <= 0) {
        throw new Error('eligible subject normalizedCharCount must be positive');
      }
      if (subject.preflightAvailableUnits <= 0n) {
        throw new Error('eligible subject preflightAvailableUnits must be positive');
      }
      if (seen.has(subject.userId)) throw new Error('duplicate eligible subject userId');
      seen.add(subject.userId);
    }
    return subjects;
  }
}
