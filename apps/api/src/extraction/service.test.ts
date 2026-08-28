import { describe, expect, it } from 'vitest';
import { defaultProductConfig } from '../config/product';
import {
  ConversationExtractionCoordinator,
  type ExtractionBatchClaim,
  type ExtractionClaimRepository,
  type ExtractionClaimThresholds,
} from './service';

class FakeRepository implements ExtractionClaimRepository {
  claim: ExtractionBatchClaim | null = null;
  received:
    | { groupId: number; now: Date; leaseUntil: Date; thresholds: ExtractionClaimThresholds }
    | undefined;
  succeeded: number[] = [];
  deferred: Array<{ batchId: number; retryAt: Date; errorCode: string }> = [];

  async claimDueBatch(
    groupId: number,
    now: Date,
    leaseUntil: Date,
    thresholds: ExtractionClaimThresholds,
  ): Promise<ExtractionBatchClaim | null> {
    this.received = { groupId, now, leaseUntil, thresholds };
    return this.claim;
  }

  async markSucceeded(batchId: number): Promise<boolean> {
    this.succeeded.push(batchId);
    return true;
  }

  async deferFailure(batchId: number, retryAt: Date, errorCode: string): Promise<boolean> {
    this.deferred.push({ batchId, retryAt, errorCode });
    return true;
  }
}

describe('ConversationExtractionCoordinator', () => {
  it('forwards threshold configuration and creates a bounded lease', async () => {
    const repository = new FakeRepository();
    const coordinator = new ConversationExtractionCoordinator(repository, defaultProductConfig);
    const now = new Date('2026-08-29T04:00:00Z');

    await coordinator.claimDueBatch(7, now);

    expect(repository.received).toEqual({
      groupId: 7,
      now,
      leaseUntil: new Date('2026-08-29T04:02:00Z'),
      thresholds: {
        messageThreshold: 30,
        charThreshold: 5_000,
        largeMessageChars: 2_000,
      },
    });
  });

  it('normalizes failure codes before persistence', async () => {
    const repository = new FakeRepository();
    const coordinator = new ConversationExtractionCoordinator(repository, defaultProductConfig);
    const retryAt = new Date('2026-08-29T04:05:00Z');

    await coordinator.deferFailure(9, retryAt, '   ');

    expect(repository.deferred).toEqual([{ batchId: 9, retryAt, errorCode: 'UNKNOWN' }]);
  });
});
