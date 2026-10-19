import type { NotificationCategory } from './notifications';
import type {
  WebPushPayload,
  WebPushSubscriptionTarget,
  WebPushTransportResult,
} from './web-push-transport';

export type PushDeliverySubscription = WebPushSubscriptionTarget & {
  id: number;
};

export type PushDeliveryCandidate = {
  recipientId: number;
  notificationId: number;
  userId: number;
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink: string | null;
  attemptCount: number;
  preferenceEnabled: boolean;
  subscriptions: PushDeliverySubscription[];
};

export type PushDeliveryBatchResult = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  rescheduled: number;
  staleCompletions: number;
};

export interface PushDeliveryRepository {
  claimPending(limit: number, staleBefore: Date): Promise<PushDeliveryCandidate[]>;
  recordSubscriptionSuccess(subscriptionId: number, userId: number): Promise<void>;
  revokeSubscription(subscriptionId: number, userId: number): Promise<void>;
  markSent(recipientId: number, attemptCount: number): Promise<boolean>;
  markSkipped(recipientId: number, attemptCount: number, code: string): Promise<boolean>;
  markFailed(recipientId: number, attemptCount: number, code: string): Promise<boolean>;
  reschedule(recipientId: number, attemptCount: number, code: string, retryAt: Date): Promise<boolean>;
}

export interface PushDeliveryTransport {
  send(subscription: WebPushSubscriptionTarget, payload: WebPushPayload): Promise<WebPushTransportResult>;
}

export type PushDeliveryOptions = {
  maxAttempts?: number;
  claimLeaseMs?: number;
  now?: () => Date;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CLAIM_LEASE_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [5, 15, 30, 60, 180].map((minutes) => minutes * 60 * 1000);

/**
 * Bounded push sender. Durable IN_APP notification rows are already committed before this
 * service runs; PUSH is only an optional delivery layer and can fail/retry independently.
 */
export class PushDeliveryService {
  private readonly maxAttempts: number;
  private readonly claimLeaseMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: PushDeliveryRepository,
    private readonly transport: PushDeliveryTransport,
    options: PushDeliveryOptions = {},
  ) {
    this.maxAttempts = positiveBounded(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 10, 'INVALID_PUSH_MAX_ATTEMPTS');
    this.claimLeaseMs = positiveBounded(options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS, 30 * 60 * 1000, 'INVALID_PUSH_CLAIM_LEASE');
    this.now = options.now ?? (() => new Date());
  }

  async deliverPendingBatch(limit = 50): Promise<PushDeliveryBatchResult> {
    const boundedLimit = positiveBounded(limit, 200, 'INVALID_PUSH_BATCH_LIMIT');
    const now = this.now();
    const staleBefore = new Date(now.getTime() - this.claimLeaseMs);
    const candidates = await this.repository.claimPending(boundedLimit, staleBefore);
    const result: PushDeliveryBatchResult = {
      claimed: candidates.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      rescheduled: 0,
      staleCompletions: 0,
    };

    for (const candidate of candidates) {
      const outcome = await this.deliverCandidate(candidate, now);
      if (!outcome.applied) result.staleCompletions += 1;
      if (outcome.applied) result[outcome.status] += 1;
    }
    return result;
  }

  private async deliverCandidate(
    candidate: PushDeliveryCandidate,
    now: Date,
  ): Promise<{ applied: boolean; status: 'sent' | 'failed' | 'skipped' | 'rescheduled' }> {
    if (!candidate.preferenceEnabled) {
      return {
        applied: await this.repository.markSkipped(
          candidate.recipientId,
          candidate.attemptCount,
          'PUSH_DISABLED_BY_USER',
        ),
        status: 'skipped',
      };
    }
    if (candidate.subscriptions.length === 0) {
      return {
        applied: await this.repository.markSkipped(
          candidate.recipientId,
          candidate.attemptCount,
          'NO_ACTIVE_PUSH_SUBSCRIPTION',
        ),
        status: 'skipped',
      };
    }

    const payload: WebPushPayload = {
      notificationId: candidate.notificationId,
      title: candidate.title,
      body: candidate.body,
      deepLink: candidate.deepLink,
    };
    let successCount = 0;
    let transientCount = 0;
    let permanentInvalidCount = 0;
    let lastFailure = 'PUSH_DELIVERY_FAILED';

    for (const subscription of candidate.subscriptions) {
      try {
        const delivery = await this.transport.send(subscription, payload);
        if (delivery.ok) {
          successCount += 1;
          await this.repository.recordSubscriptionSuccess(subscription.id, candidate.userId);
          continue;
        }
        if (permanentlyInvalidSubscription(delivery.status)) {
          permanentInvalidCount += 1;
          lastFailure = `PUSH_HTTP_${delivery.status}`;
          await this.repository.revokeSubscription(subscription.id, candidate.userId);
          continue;
        }
        if (transientHttpStatus(delivery.status)) {
          transientCount += 1;
          lastFailure = `PUSH_HTTP_${delivery.status}`;
          continue;
        }
        lastFailure = `PUSH_HTTP_${delivery.status || 0}`;
      } catch (error) {
        transientCount += 1;
        lastFailure = transportFailureCode(error);
      }
    }

    if (successCount > 0) {
      return {
        applied: await this.repository.markSent(candidate.recipientId, candidate.attemptCount),
        status: 'sent',
      };
    }

    const canRetry = transientCount > 0 && candidate.attemptCount < this.maxAttempts;
    if (canRetry) {
      const retryAt = new Date(now.getTime() + retryDelayMs(candidate.attemptCount));
      return {
        applied: await this.repository.reschedule(
          candidate.recipientId,
          candidate.attemptCount,
          lastFailure,
          retryAt,
        ),
        status: 'rescheduled',
      };
    }

    const failureCode = transientCount > 0
      ? 'PUSH_RETRY_EXHAUSTED'
      : permanentInvalidCount === candidate.subscriptions.length
        ? 'PUSH_SUBSCRIPTIONS_INVALID'
        : lastFailure;
    return {
      applied: await this.repository.markFailed(candidate.recipientId, candidate.attemptCount, failureCode),
      status: 'failed',
    };
  }
}

export function permanentlyInvalidSubscription(status: number): boolean {
  return status === 404 || status === 410;
}

export function transientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500 || status <= 0;
}

export function retryDelayMs(attemptCount: number): number {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attemptCount - 1));
  return RETRY_DELAYS_MS[index];
}

function transportFailureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return error.message.slice(0, 128);
  }
  return 'PUSH_TRANSPORT_ERROR';
}

function positiveBounded(value: number, max: number, error: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error(error);
  return value;
}
