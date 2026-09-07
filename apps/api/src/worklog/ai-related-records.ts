import type { AiEntitlementDecision } from './ai-entitlement';

export type AiRelatedRecord = {
  id: number;
  sourceId: number;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  title: string | null;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
  relevanceScore: number;
};

export interface AiRelatedRecordsRepository {
  relatedEnabled(): Promise<boolean>;
  findRelated(input: {
    sourceId: number;
    recordId: number;
    limit: number;
  }): Promise<{ targetFound: boolean; records: AiRelatedRecord[] }>;
}

export type AiRelatedRecordsEntitlementPort = {
  resolve(userId: number, sourceId: number, at?: Date): Promise<AiEntitlementDecision>;
};

export type AiRelatedRecordsResult =
  | {
      status: 'RESULTS';
      entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
      recordId: number;
      records: AiRelatedRecord[];
    }
  | { status: 'BLOCKED'; decision: AiEntitlementDecision }
  | { status: 'NOT_FOUND'; reason: 'RECORD_NOT_FOUND' }
  | { status: 'FAILED'; reason: 'AI_RELATED_RECORDS_DISABLED' | 'AI_RELATED_RECORDS_RETRIEVAL_FAILED' };

/**
 * Related Records is an entitled AI-product capability with deterministic retrieval.
 *
 * V1 ranking stays inside PostgreSQL and does not call a provider, so this service must not
 * manufacture provider usage, reserve AI points, or charge the FREE trial. Entitlement is
 * still checked first so exhausted/not-entitled users cannot use paid product surfaces and
 * unauthorized callers cannot probe whether a Record exists inside another Source.
 */
export class AiRelatedRecordsService {
  constructor(
    private readonly repository: AiRelatedRecordsRepository,
    private readonly entitlement: AiRelatedRecordsEntitlementPort,
  ) {}

  async related(input: {
    userId: number;
    sourceId: number;
    recordId: number;
    limit?: number;
    referenceAt?: Date;
  }): Promise<AiRelatedRecordsResult> {
    const userId = positiveId(input.userId, 'INVALID_USER_ID');
    const sourceId = positiveId(input.sourceId, 'INVALID_SOURCE_ID');
    const recordId = positiveId(input.recordId, 'INVALID_RECORD_ID');
    const limit = boundedLimit(input.limit ?? 8);
    const referenceAt = validDate(input.referenceAt ?? new Date());

    const decision = await this.entitlement.resolve(userId, sourceId, referenceAt);
    if (!decision.allowed || decision.source === 'BLOCKED') return { status: 'BLOCKED', decision };
    if (!(await this.repository.relatedEnabled())) {
      return { status: 'FAILED', reason: 'AI_RELATED_RECORDS_DISABLED' };
    }

    try {
      const result = await this.repository.findRelated({ sourceId, recordId, limit });
      if (!result.targetFound) return { status: 'NOT_FOUND', reason: 'RECORD_NOT_FOUND' };
      return {
        status: 'RESULTS',
        entitlementSource: decision.source,
        recordId,
        records: result.records,
      };
    } catch {
      return { status: 'FAILED', reason: 'AI_RELATED_RECORDS_RETRIEVAL_FAILED' };
    }
  }
}

function positiveId(value: number, error: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
  return value;
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) throw new Error('AI_RELATED_RECORDS_LIMIT_INVALID');
  return value;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_REFERENCE_TIME');
  return new Date(value.getTime());
}
