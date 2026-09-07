export type SubscriptionLifecycleEventType = 'ACTIVATE' | 'RENEW' | 'CANCEL';

export type SubscriptionLifecycleEvent = {
  provider: string;
  externalEventKey: string;
  type: SubscriptionLifecycleEventType;
  userId: number;
  planCode: 'AI_PRO';
  occurredAt: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  metadata?: Record<string, unknown>;
};

export type SubscriptionLifecycleApplied = {
  subscriptionId: number;
  userId: number;
  type: SubscriptionLifecycleEventType;
  periodStart: Date | null;
  periodEnd: Date | null;
};

export type SubscriptionLifecycleApplyResult =
  | ({ status: 'APPLIED' } & SubscriptionLifecycleApplied)
  | {
      status: 'DUPLICATE';
      /**
       * Present when the original event was applied. The service intentionally replays the
       * deterministic/idempotent SYSTEM notification so a transient notification failure on
       * the first webhook attempt can heal on provider retry.
       */
      applied: SubscriptionLifecycleApplied | null;
    }
  | {
      status: 'IGNORED_STALE';
      userId: number;
      type: SubscriptionLifecycleEventType;
    };

export interface SubscriptionLifecycleRepository {
  apply(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult>;
}

export interface SubscriptionLifecycleNotificationPort {
  activated(input: {
    userId: number;
    subscriptionId: number;
    planCode: 'AI_PRO';
    periodStart: Date;
    periodEnd: Date | null;
  }): Promise<void>;
  renewed(input: { userId: number; subscriptionId: number; periodStart: Date; periodEnd: Date | null }): Promise<void>;
  cancelled(input: { userId: number; subscriptionId: number; periodEnd: Date | null }): Promise<void>;
}

/**
 * Payment-provider-neutral subscription lifecycle boundary.
 *
 * Provider adapters must verify their own webhook authenticity first, then translate the
 * external event into this small AFTERTRACE contract. Core subscription/Grant/notification
 * behavior does not depend on Stripe, ECPay, LINE Pay, or any other payment vendor.
 */
export class SubscriptionLifecycleService {
  constructor(
    private readonly repository: SubscriptionLifecycleRepository,
    private readonly notifications: SubscriptionLifecycleNotificationPort,
  ) {}

  async apply(input: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    const event = normalizeEvent(input);
    const result = await this.repository.apply(event);

    if (result.status === 'IGNORED_STALE') return result;
    if (result.status === 'DUPLICATE') {
      if (result.applied) await this.emitNotification(result.applied);
      return result;
    }

    await this.emitNotification(result);
    return result;
  }

  private async emitNotification(result: SubscriptionLifecycleApplied): Promise<void> {
    if (result.type === 'ACTIVATE') {
      if (!result.periodStart) throw new Error('SUBSCRIPTION_ACTIVATE_PERIOD_START_MISSING');
      await this.notifications.activated({
        userId: result.userId,
        subscriptionId: result.subscriptionId,
        planCode: 'AI_PRO',
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
      });
    } else if (result.type === 'RENEW') {
      if (!result.periodStart) throw new Error('SUBSCRIPTION_RENEW_PERIOD_START_MISSING');
      await this.notifications.renewed({
        userId: result.userId,
        subscriptionId: result.subscriptionId,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
      });
    } else {
      await this.notifications.cancelled({
        userId: result.userId,
        subscriptionId: result.subscriptionId,
        periodEnd: result.periodEnd,
      });
    }
  }
}

function normalizeEvent(input: SubscriptionLifecycleEvent): SubscriptionLifecycleEvent {
  const provider = normalizedIdentifier(input.provider, 64, 'SUBSCRIPTION_PROVIDER_INVALID').toUpperCase();
  const externalEventKey = normalizedIdentifier(input.externalEventKey, 255, 'SUBSCRIPTION_EVENT_KEY_INVALID');
  const userId = positiveInteger(input.userId, 'SUBSCRIPTION_USER_ID_INVALID');
  if (input.planCode !== 'AI_PRO') throw new Error('V1_ONLY_AI_PRO_SUBSCRIPTION');
  if (input.type !== 'ACTIVATE' && input.type !== 'RENEW' && input.type !== 'CANCEL') {
    throw new Error('SUBSCRIPTION_EVENT_TYPE_INVALID');
  }
  const occurredAt = validDate(input.occurredAt, 'SUBSCRIPTION_OCCURRED_AT_INVALID');
  const periodStart = input.periodStart == null ? null : validDate(input.periodStart, 'SUBSCRIPTION_PERIOD_START_INVALID');
  const periodEnd = input.periodEnd == null ? null : validDate(input.periodEnd, 'SUBSCRIPTION_PERIOD_END_INVALID');

  if (input.type === 'ACTIVATE' || input.type === 'RENEW') {
    if (!periodStart || !periodEnd || periodStart.getTime() >= periodEnd.getTime()) {
      throw new Error('SUBSCRIPTION_PERIOD_INVALID');
    }
  } else if (periodEnd && periodEnd.getTime() < occurredAt.getTime()) {
    throw new Error('SUBSCRIPTION_CANCEL_PERIOD_INVALID');
  }

  return {
    provider,
    externalEventKey,
    type: input.type,
    userId,
    planCode: 'AI_PRO',
    occurredAt,
    periodStart,
    periodEnd,
    metadata: boundedMetadata(input.metadata),
  };
}

function normalizedIdentifier(value: string, max: number, error: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(error);
  return normalized;
}

function positiveInteger(value: number, error: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
  return value;
}

function validDate(value: Date, error: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(error);
  return new Date(value.getTime());
}

function boundedMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const encoded = JSON.stringify(value);
  if (encoded.length > 8_192) throw new Error('SUBSCRIPTION_EVENT_METADATA_TOO_LARGE');
  return JSON.parse(encoded) as Record<string, unknown>;
}
