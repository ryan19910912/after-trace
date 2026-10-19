import type { Database } from '../db/client';
import { DrizzleNotificationRepository } from './drizzle-notifications';
import { NotificationService } from './notifications';
import type { SubscriptionLifecycleNotificationPort } from './subscription-lifecycle';
import { notifySubscriptionEvent } from './system-notification-events';

export class SubscriptionLifecycleNotificationAdapter implements SubscriptionLifecycleNotificationPort {
  private readonly service: NotificationService;

  constructor(database: Database) {
    this.service = new NotificationService(new DrizzleNotificationRepository(database));
  }

  activated(input: {
    userId: number;
    subscriptionId: number;
    planCode: string;
    periodStart: Date;
    periodEnd: Date | null;
  }) {
    return notifySubscriptionEvent(this.service, input.userId, {
      type: 'ACTIVATED',
      subscriptionId: input.subscriptionId,
      planCode: input.planCode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
  }

  renewed(input: { userId: number; subscriptionId: number; planCode: string; periodStart: Date; periodEnd: Date | null }) {
    return notifySubscriptionEvent(this.service, input.userId, {
      type: 'RENEWED',
      subscriptionId: input.subscriptionId,
      planCode: input.planCode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
  }

  cancelled(input: { userId: number; subscriptionId: number; planCode: string; periodEnd: Date | null }) {
    return notifySubscriptionEvent(this.service, input.userId, {
      type: 'CANCELLED',
      subscriptionId: input.subscriptionId,
      planCode: input.planCode,
      periodEnd: input.periodEnd,
    });
  }
}
