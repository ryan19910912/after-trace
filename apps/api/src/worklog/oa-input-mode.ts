export type WorklogPrivateInputMode = 'RECORD' | 'QUERY';

export type WorklogPrivateInputModeConsumeResult =
  | { status: 'ACTIVE'; action: WorklogPrivateInputMode }
  | { status: 'EXPIRED' }
  | { status: 'NONE' };

export interface WorklogPrivateInputModeRepository {
  set(input: {
    userId: number;
    action: WorklogPrivateInputMode;
    expiresAt: Date;
    at: Date;
  }): Promise<void>;
  consume(userId: number, at: Date): Promise<WorklogPrivateInputModeConsumeResult>;
}

export const WORKLOG_PRIVATE_INPUT_MODE_TTL_MS = 10 * 60_000;

export class WorklogPrivateInputModeService {
  constructor(private readonly repository: WorklogPrivateInputModeRepository) {}

  async set(userId: number, action: WorklogPrivateInputMode, at = new Date()): Promise<void> {
    const normalizedUserId = positiveInteger(userId, 'userId');
    const normalizedAt = validDate(at, 'at');
    await this.repository.set({
      userId: normalizedUserId,
      action,
      at: normalizedAt,
      expiresAt: new Date(normalizedAt.getTime() + WORKLOG_PRIVATE_INPUT_MODE_TTL_MS),
    });
  }

  async consume(userId: number, at = new Date()): Promise<WorklogPrivateInputModeConsumeResult> {
    return this.repository.consume(positiveInteger(userId, 'userId'), validDate(at, 'at'));
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} must be valid`);
  return new Date(value.getTime());
}
