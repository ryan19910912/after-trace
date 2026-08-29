export type MemoryRecoveryInput = {
  requestId: number;
  expectedAttemptCount: number;
  operatorRef: string;
  reason: string;
  requeuedAt?: Date;
};

export interface MemoryRecoveryRepository {
  requeueFailed(input: {
    requestId: number;
    expectedAttemptCount: number;
    operatorRef: string;
    reason: string;
    requeuedAt: Date;
  }): Promise<boolean>;
}

export type MemoryRecoveryResult =
  | { status: 'REQUEUED'; requestId: number }
  | { status: 'NOT_REQUEUED'; requestId: number };

export class MemoryRecoveryService {
  constructor(private readonly repository: MemoryRecoveryRepository) {}

  async requeueFailed(input: MemoryRecoveryInput): Promise<MemoryRecoveryResult> {
    assertPositiveSafeInteger(input.requestId, 'requestId');
    assertPositiveSafeInteger(input.expectedAttemptCount, 'expectedAttemptCount');
    const operatorRef = normalizeText(input.operatorRef, 'operatorRef', 128);
    const reason = normalizeText(input.reason, 'reason', 512);
    const requeued = await this.repository.requeueFailed({
      requestId: input.requestId,
      expectedAttemptCount: input.expectedAttemptCount,
      operatorRef,
      reason,
      requeuedAt: input.requeuedAt ?? new Date(),
    });
    return requeued
      ? { status: 'REQUEUED', requestId: input.requestId }
      : { status: 'NOT_REQUEUED', requestId: input.requestId };
  }
}

function normalizeText(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${name} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
