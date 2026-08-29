import type { ReminderMutationResult, ReminderDeliveryStatus } from './service';

export type ReminderDispatchClaim = {
  reminderId: number;
  groupId: number;
  lineGroupId: string;
  message: string;
  attemptCount: number;
  retryKey: string;
  retryKeyExpiresAt: Date;
};

export type ReminderDispatchAuthorization =
  | 'AUTHORIZED'
  | 'STALE'
  | 'CANCELLED'
  | 'INACTIVE'
  | 'OWNER_LEFT';

export interface ReminderDeliveryRepository {
  claimDue(at: Date, leaseExpiresAt: Date, retryKey: string): Promise<ReminderDispatchClaim | null>;
  authorizeDispatch(claim: ReminderDispatchClaim, at: Date): Promise<ReminderDispatchAuthorization>;
  releaseForRetry(claim: ReminderDispatchClaim, at: Date): Promise<boolean>;
  settleAccepted(
    claim: ReminderDispatchClaim,
    deliveryReference: string,
    at: Date,
  ): Promise<ReminderMutationResult<ReminderDeliveryStatus>>;
}

export type LinePushResult =
  | { status: 'ACCEPTED'; deliveryReference: string }
  | { status: 'RETRYABLE_FAILURE'; code: string }
  | { status: 'PERMANENT_FAILURE'; code: string };

export interface ReminderLinePushClient {
  push(groupId: string, message: string, retryKey: string): Promise<LinePushResult>;
}

export type ReminderDeliveryRunResult = {
  claimed: number;
  delivered: number;
  deferred: number;
  ownerLeftCancelled: number;
  permanentFailures: number;
};

const DEFAULT_CLAIM_LIMIT = 20;
const CLAIM_LEASE_MS = 2 * 60 * 1000;

export class ReminderDeliveryService {
  constructor(
    private readonly repository: ReminderDeliveryRepository,
    private readonly line: ReminderLinePushClient,
  ) {}

  async deliverDue(at = new Date(), limit = DEFAULT_CLAIM_LIMIT): Promise<ReminderDeliveryRunResult> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }

    const result: ReminderDeliveryRunResult = {
      claimed: 0,
      delivered: 0,
      deferred: 0,
      ownerLeftCancelled: 0,
      permanentFailures: 0,
    };

    for (let i = 0; i < limit; i += 1) {
      const retryKey = crypto.randomUUID();
      const claim = await this.repository.claimDue(
        at,
        new Date(at.getTime() + CLAIM_LEASE_MS),
        retryKey,
      );
      if (!claim) break;
      result.claimed += 1;

      const authorization = await this.repository.authorizeDispatch(claim, at);
      if (authorization === 'OWNER_LEFT') {
        result.ownerLeftCancelled += 1;
        continue;
      }
      if (authorization !== 'AUTHORIZED') {
        result.deferred += 1;
        continue;
      }

      const push = await this.line.push(claim.lineGroupId, claim.message, claim.retryKey);
      if (push.status === 'ACCEPTED') {
        const settlement = await this.repository.settleAccepted(
          claim,
          push.deliveryReference,
          new Date(),
        );
        if (settlement.status === 'DELIVERED' || settlement.status === 'ALREADY_DELIVERED') {
          result.delivered += 1;
        } else {
          throw new Error(`accepted LINE delivery could not settle: ${settlement.status}`);
        }
        continue;
      }

      if (
        push.status === 'RETRYABLE_FAILURE' &&
        new Date().getTime() < claim.retryKeyExpiresAt.getTime()
      ) {
        await this.repository.releaseForRetry(claim, new Date());
        result.deferred += 1;
        continue;
      }

      // Keep DISPATCHING + reservation after ambiguous/permanent delivery failure.
      // A later operator/recovery path must decide refund vs retry; never guess consumption.
      result.permanentFailures += 1;
    }

    return result;
  }
}
