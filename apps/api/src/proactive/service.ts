export type ProactiveEnqueueResult =
  | { status: 'CREATED' | 'ALREADY_CREATED'; pushId: number }
  | { status: 'OWNER_NOT_FOUND' | 'GROUP_NOT_FOUND' | 'GROUP_INACTIVE' | 'OWNER_NOT_GROUP_MEMBER' | 'PROACTIVE_NOT_AVAILABLE' | 'REFERENCE_CONFLICT'; pushId: number | null };

export type ProactiveDispatchClaim = {
  pushId: number;
  userId: number;
  groupId: number;
  lineGroupId: string;
  message: string;
  attemptCount: number;
  retryKey: string;
};

export type ProactiveClaimResult =
  | { status: 'CLAIMED'; claim: ProactiveDispatchClaim }
  | { status: 'CANCELLED_INELIGIBLE'; pushId: number }
  | { status: 'NO_WORK' };

export interface ProactiveRepository {
  enqueue(input: {
    ownerLineUserId: string;
    lineGroupId: string;
    requestKey: string;
    sourceType: string;
    sourceId: string;
    message: string;
    scheduledFor: Date;
    at: Date;
  }): Promise<ProactiveEnqueueResult>;
  claimNext(at: Date, leaseUntil: Date, retryKey: string): Promise<ProactiveClaimResult>;
  markDelivered(claim: ProactiveDispatchClaim, at: Date): Promise<boolean>;
  releaseForRetry(claim: ProactiveDispatchClaim, at: Date, errorCode: string): Promise<boolean>;
  cancelFailed(claim: ProactiveDispatchClaim, at: Date, errorCode: string): Promise<boolean>;
}

export class ProactivePushService {
  constructor(private readonly repository: ProactiveRepository) {}

  enqueue(input: {
    ownerLineUserId: string;
    lineGroupId: string;
    requestKey: string;
    sourceType: string;
    sourceId: string;
    message: string;
    scheduledFor: Date;
    at?: Date;
  }): Promise<ProactiveEnqueueResult> {
    return this.repository.enqueue({
      ownerLineUserId: bounded(input.ownerLineUserId, 'ownerLineUserId', 64),
      lineGroupId: bounded(input.lineGroupId, 'lineGroupId', 64),
      requestKey: bounded(input.requestKey, 'requestKey', 128),
      sourceType: bounded(input.sourceType, 'sourceType', 64),
      sourceId: bounded(input.sourceId, 'sourceId', 160),
      message: bounded(input.message, 'message', 5000),
      scheduledFor: validDate(input.scheduledFor, 'scheduledFor'),
      at: input.at ?? new Date(),
    });
  }
}

export type ProactiveLineClient = {
  push(groupId: string, message: string, retryKey: string): Promise<
    | { status: 'ACCEPTED'; deliveryReference: string }
    | { status: 'RETRYABLE_FAILURE'; code: string }
    | { status: 'PERMANENT_FAILURE'; code: string }
  >;
};

export class ProactiveDeliveryService {
  constructor(
    private readonly repository: ProactiveRepository,
    private readonly line: ProactiveLineClient,
  ) {}

  async deliverDue(at = new Date(), limit = 20): Promise<{
    claimed: number;
    delivered: number;
    cancelled: number;
    deferred: number;
  }> {
    const result = { claimed: 0, delivered: 0, cancelled: 0, deferred: 0 };
    for (let i = 0; i < limit; i += 1) {
      const next = await this.repository.claimNext(
        at,
        new Date(at.getTime() + 2 * 60_000),
        crypto.randomUUID(),
      );
      if (next.status === 'NO_WORK') break;
      if (next.status === 'CANCELLED_INELIGIBLE') {
        result.cancelled += 1;
        continue;
      }
      result.claimed += 1;
      const sent = await this.line.push(
        next.claim.lineGroupId,
        next.claim.message,
        next.claim.retryKey,
      );
      if (sent.status === 'ACCEPTED') {
        const settled = await this.repository.markDelivered(next.claim, new Date());
        if (!settled) throw new Error('accepted proactive Push lost its delivery fence');
        result.delivered += 1;
      } else if (sent.status === 'RETRYABLE_FAILURE') {
        await this.repository.releaseForRetry(next.claim, new Date(), sent.code);
        result.deferred += 1;
      } else {
        await this.repository.cancelFailed(next.claim, new Date(), sent.code);
        result.cancelled += 1;
      }
    }
    return result;
  }
}

function bounded(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${name} must contain 1-${max} characters`);
  return normalized;
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid Date`);
  return value;
}
