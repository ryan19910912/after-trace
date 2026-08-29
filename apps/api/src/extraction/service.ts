import type { ProductConfig } from '../config/product';

export type ExtractionBatchClaim = {
  id: number;
  groupId: number;
  messageCount: number;
  charCount: number;
  firstMessageId: number;
  lastMessageId: number;
  attemptCount: number;
  leaseExpiresAt: Date;
};

export type ExtractionClaimThresholds = {
  messageThreshold: number;
  charThreshold: number;
  largeMessageChars: number;
};

export interface ExtractionClaimRepository {
  claimDueBatch(
    groupId: number,
    now: Date,
    leaseUntil: Date,
    thresholds: ExtractionClaimThresholds,
  ): Promise<ExtractionBatchClaim | null>;
  markSucceeded(batchId: number, completedAt: Date): Promise<boolean>;
  markTerminalSkipped(batchId: number, completedAt: Date, errorCode: string): Promise<boolean>;
  deferFailure(batchId: number, retryAt: Date, errorCode: string): Promise<boolean>;
}

export class ConversationExtractionCoordinator {
  constructor(
    private readonly repository: ExtractionClaimRepository,
    private readonly config: ProductConfig,
  ) {}

  claimDueBatch(groupId: number, now = new Date()): Promise<ExtractionBatchClaim | null> {
    const leaseUntil = new Date(
      now.getTime() + this.config.conversation.extractionLeaseSeconds * 1_000,
    );

    return this.repository.claimDueBatch(groupId, now, leaseUntil, {
      messageThreshold: this.config.conversation.extractionMessageThreshold,
      charThreshold: this.config.conversation.extractionCharThreshold,
      largeMessageChars: this.config.conversation.largeMessageChars,
    });
  }

  markSucceeded(batchId: number, completedAt = new Date()): Promise<boolean> {
    return this.repository.markSucceeded(batchId, completedAt);
  }

  markNoEligibleParticipant(batchId: number, completedAt = new Date()): Promise<boolean> {
    return this.repository.markTerminalSkipped(
      batchId,
      completedAt,
      'NO_ELIGIBLE_ENERGY_PARTICIPANT',
    );
  }

  deferFailure(
    batchId: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<boolean> {
    const normalized = errorCode.trim().slice(0, 128) || 'UNKNOWN';
    return this.repository.deferFailure(batchId, retryAt, normalized);
  }
}
