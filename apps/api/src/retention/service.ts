export type RetentionPurgeStatus = 'PURGED_ANCHOR_RETAINED' | 'PURGED_GROUP_REMOVED';

export type RetentionPurgeResult = {
  status: RetentionPurgeStatus;
  groupId: number;
};

export type RetentionSweepCommand = {
  at: Date;
  neverPaidBefore: Date;
  paidBefore: Date;
};

export interface RetentionRepository {
  purgeNext(command: RetentionSweepCommand): Promise<RetentionPurgeResult | null>;
  countBlockedDue(command: RetentionSweepCommand): Promise<number>;
}

export type RetentionRunResult = {
  purged: number;
  retainedPaidAnchors: number;
  removedGroups: number;
  blockedUnresolvedReminders: number;
};

const NEVER_PAID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
  return value;
}

export function retentionCutoffs(at: Date): RetentionSweepCommand {
  const current = validDate(at, 'at');
  const paidBefore = new Date(current.getTime());
  paidBefore.setUTCFullYear(paidBefore.getUTCFullYear() - 1);

  return {
    at: current,
    neverPaidBefore: new Date(current.getTime() - NEVER_PAID_RETENTION_MS),
    paidBefore,
  };
}

export class GroupRetentionService {
  constructor(private readonly repository: RetentionRepository) {}

  async purgeExpired(at = new Date(), limit = DEFAULT_LIMIT): Promise<RetentionRunResult> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }

    const command = retentionCutoffs(at);
    const result: RetentionRunResult = {
      purged: 0,
      retainedPaidAnchors: 0,
      removedGroups: 0,
      blockedUnresolvedReminders: await this.repository.countBlockedDue(command),
    };

    for (let i = 0; i < limit; i += 1) {
      const purge = await this.repository.purgeNext(command);
      if (!purge) break;
      result.purged += 1;
      if (purge.status === 'PURGED_ANCHOR_RETAINED') result.retainedPaidAnchors += 1;
      else result.removedGroups += 1;
    }

    return result;
  }
}
