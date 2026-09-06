import type { WorklogTextNormalizationOutput } from './text-normalization';

export type WorklogInterpretedRecordApplyResult =
  | { status: 'APPLIED'; entityId: number; createdEntity: boolean }
  | { status: 'PENDING_CONFIRMATION'; confirmationId: number }
  | { status: 'ALREADY_APPLIED'; entityId: number | null }
  | { status: 'RECORD_CHANGED' };

export interface WorklogInterpretedRecordRepository {
  apply(input: {
    recordId: number;
    actorUserId: number;
    output: WorklogTextNormalizationOutput;
  }): Promise<WorklogInterpretedRecordApplyResult>;
}

/**
 * Applies a provider result that was already produced and charged by the one-call LINE
 * natural-language interpreter. This layer never invokes AI again.
 */
export class WorklogInterpretedRecordService {
  constructor(private readonly repository: WorklogInterpretedRecordRepository) {}

  apply(input: {
    recordId: number;
    actorUserId: number;
    output: WorklogTextNormalizationOutput;
  }): Promise<WorklogInterpretedRecordApplyResult> {
    if (!Number.isSafeInteger(input.recordId) || input.recordId <= 0) throw new Error('recordId must be positive');
    if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0) throw new Error('actorUserId must be positive');
    return this.repository.apply(input);
  }
}
