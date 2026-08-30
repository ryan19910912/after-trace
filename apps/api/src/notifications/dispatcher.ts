import type { Bindings } from '../env';
import { DrizzleNotificationRepository } from './repository';
import { resolveVapidConfig, sendEmptyWebPush } from './vapid';

const DISPATCH_LEASE_MS = 90_000;
const MAX_ATTEMPTS = 4;

export type NotificationDispatchSummary = {
  configured: boolean;
  expired: number;
  due: number;
  claimed: number;
  accepted: number;
  retried: number;
  failed: number;
  gone: number;
  waitingForSubscription: number;
  configError?: string;
};

function retryDelayMs(attemptCount: number): number {
  return Math.min(10 * 60_000, 60_000 * 2 ** Math.max(0, attemptCount - 1));
}

export class WebPushDispatcher {
  constructor(
    private readonly repository: DrizzleNotificationRepository,
    private readonly env: Bindings,
  ) {}

  async run(now = new Date()): Promise<NotificationDispatchSummary> {
    const summary: NotificationDispatchSummary = {
      configured: false,
      expired: await this.repository.expireStalePending(now),
      due: 0,
      claimed: 0,
      accepted: 0,
      retried: 0,
      failed: 0,
      gone: 0,
      waitingForSubscription: 0,
    };

    let config;
    try {
      config = resolveVapidConfig(this.env);
    } catch (error) {
      summary.configError = error instanceof Error ? error.message : 'INVALID_VAPID_CONFIGURATION';
      return summary;
    }
    if (!config) return summary;
    summary.configured = true;

    const due = await this.repository.listDuePushDeliveries(now);
    summary.due = due.length;

    for (const delivery of due) {
      const subscription = await this.repository.getActiveSubscription(delivery.userId, delivery.subscriptionId);
      if (!subscription) {
        summary.waitingForSubscription += 1;
        continue;
      }

      const claimKey = crypto.randomUUID();
      const claimed = await this.repository.claimDelivery(
        delivery.deliveryId,
        claimKey,
        now,
        new Date(now.getTime() + DISPATCH_LEASE_MS),
      );
      if (!claimed) continue;
      summary.claimed += 1;

      await this.repository.bindSubscription(delivery.deliveryId, subscription.id);
      const result = await sendEmptyWebPush(subscription.endpoint, config);

      if (result.status === 'ACCEPTED') {
        await this.repository.settleAccepted(delivery.deliveryId, claimKey, now);
        summary.accepted += 1;
        continue;
      }

      if (result.status === 'SUBSCRIPTION_GONE') {
        await this.repository.resetGoneSubscription(delivery.deliveryId, claimKey, subscription.id, now);
        summary.gone += 1;
        continue;
      }

      if (result.status === 'RETRYABLE') {
        const nextAttemptAt = new Date(now.getTime() + retryDelayMs(claimed.attemptCount));
        if (claimed.attemptCount < MAX_ATTEMPTS && nextAttemptAt < claimed.expiresAt) {
          await this.repository.settleRetry(
            delivery.deliveryId,
            claimKey,
            result.errorCode,
            nextAttemptAt,
            now,
          );
          summary.retried += 1;
        } else {
          await this.repository.settleFailed(
            delivery.deliveryId,
            claimKey,
            `${result.errorCode}_RETRY_EXHAUSTED`,
            now,
          );
          summary.failed += 1;
        }
        continue;
      }

      await this.repository.settleFailed(delivery.deliveryId, claimKey, result.errorCode, now);
      summary.failed += 1;
    }

    return summary;
  }
}
