import type {
  WorklogLineRecordEditOutput,
  WorklogLineRecordEditRepository,
  WorklogLineRecordEditResult,
} from './line-record-edit';
import type { WorklogReplyEditTarget } from './records';

export interface WorklogInterpretedEditStagePort {
  stage(input: {
    editId: number;
    claimToken: string;
    output: WorklogLineRecordEditOutput;
  }): Promise<void>;
}

/**
 * Applies an EDIT plan already returned and charged by the one-call LINE interpreter.
 * It reuses the existing durable edit idempotency/revision machinery but never calls a
 * provider a second time.
 */
export class WorklogInterpretedEditService {
  constructor(
    private readonly repository: Pick<WorklogLineRecordEditRepository, 'begin' | 'applyResult'>,
    private readonly stage: WorklogInterpretedEditStagePort,
    private readonly tokenFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async apply(input: {
    target: WorklogReplyEditTarget;
    actorUserId: number;
    chargedUserId: number;
    lineCommandMessageId: string;
    quotedLineMessageId: string;
    commandTimestamp: Date;
    instruction: string;
    output: WorklogLineRecordEditOutput;
  }): Promise<WorklogLineRecordEditResult> {
    const claimToken = this.tokenFactory().trim();
    if (!claimToken || claimToken.length > 64) throw new Error('invalid edit claim token');
    const begin = await this.repository.begin({
      sourceId: input.target.sourceId,
      recordId: input.target.id,
      actorUserId: input.actorUserId,
      chargedUserId: input.chargedUserId,
      lineCommandMessageId: input.lineCommandMessageId,
      quotedLineMessageId: input.quotedLineMessageId,
      commandTimestamp: input.commandTimestamp,
      instruction: input.instruction,
      expectedRecordVersion: input.target.version,
      claimToken,
    });

    if (begin.status === 'PROCESSING') return { status: 'IN_PROGRESS' };
    if (begin.status === 'PENDING_CONFIRMATION') return begin;
    if (begin.status === 'SUCCEEDED') return { status: 'EDITED', recordVersion: begin.recordVersion, entityId: begin.entityId };
    if (begin.status === 'RECORD_CHANGED') return { status: 'RECORD_CHANGED' };
    if (begin.status === 'FAILED') return { status: 'FAILED', reason: begin.reason };
    if (begin.status === 'IDEMPOTENCY_CONFLICT') return { status: 'IDEMPOTENCY_CONFLICT' };
    if (begin.status === 'NOT_ELIGIBLE') return { status: 'NOT_ELIGIBLE' };
    if (begin.status === 'PROVIDER_SUCCEEDED' || begin.status === 'USAGE_COMMITTED') {
      return { status: 'IN_PROGRESS' };
    }

    await this.stage.stage({ editId: begin.context.editId, claimToken: begin.claimToken, output: input.output });
    const applied = await this.repository.applyResult({
      editId: begin.context.editId,
      claimToken: begin.claimToken,
      output: input.output,
    });
    if (applied.status === 'APPLIED') return { status: 'EDITED', recordVersion: applied.recordVersion, entityId: applied.entityId };
    if (applied.status === 'PENDING_CONFIRMATION') return applied;
    return { status: 'RECORD_CHANGED' };
  }
}
