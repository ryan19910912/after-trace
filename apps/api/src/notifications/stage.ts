import type { NotificationDispatchSummary } from './dispatcher';

type PendingDeliveryReconciler = {
  invalidateStalePending(now?: Date): Promise<number>;
};

type PushDispatcher = {
  run(now?: Date): Promise<NotificationDispatchSummary>;
};

export type ScheduledWebPushSummary = NotificationDispatchSummary & {
  invalidated: number;
};

/**
 * Reconciles pending delivery intents immediately before dispatch so paused or
 * edited watches and no-longer-current availability cannot produce a stale
 * Push. The dispatcher still owns retry/lease/VAPID behavior.
 */
export class WebPushScheduledStage {
  constructor(
    private readonly reconciler: PendingDeliveryReconciler,
    private readonly dispatcher: PushDispatcher,
  ) {}

  async run(now = new Date()): Promise<ScheduledWebPushSummary> {
    const invalidated = await this.reconciler.invalidateStalePending(now);
    const dispatched = await this.dispatcher.run(now);
    return { ...dispatched, invalidated };
  }
}
