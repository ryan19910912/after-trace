export type ReminderRecoveryStatus =
  | 'REQUEUED'
  | 'NOT_FOUND'
  | 'NOT_DISPATCHING'
  | 'STALE'
  | 'LEASE_ACTIVE'
  | 'RETRY_KEY_EXPIRED';

export type ReminderRecoveryCommand = {
  groupId: number;
  reminderId: number;
  expectedAttemptCount: number;
  retryKey: string;
  operatorRef: string;
  reason: string;
  at: Date;
};

export interface ReminderRecoveryRepository {
  requeueUnresolved(command: ReminderRecoveryCommand): Promise<ReminderRecoveryStatus>;
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

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('at must be a valid Date');
  }
  return value;
}

export class ReminderRecoveryService {
  constructor(private readonly repository: ReminderRecoveryRepository) {}

  requeueUnresolved(
    input: Omit<ReminderRecoveryCommand, 'at'>,
    at = new Date(),
  ): Promise<ReminderRecoveryStatus> {
    return this.repository.requeueUnresolved({
      groupId: positiveSafeInteger(input.groupId, 'groupId'),
      reminderId: positiveSafeInteger(input.reminderId, 'reminderId'),
      expectedAttemptCount: positiveSafeInteger(
        input.expectedAttemptCount,
        'expectedAttemptCount',
      ),
      retryKey: bounded(input.retryKey, 'retryKey', 36),
      operatorRef: bounded(input.operatorRef, 'operatorRef', 128),
      reason: bounded(input.reason, 'reason', 500),
      at: validDate(at),
    });
  }
}
