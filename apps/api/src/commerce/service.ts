import type { ProductConfig } from '../config/product';
import type { DrizzleUserEnergyRepository } from '../energy/drizzle-repository';
import { paidPackGrant, subscriptionCycleGrant, type PaidPackCode } from '../energy/products';

export type CommerceEvent =
  | {
      type: 'SUBSCRIPTION_CYCLE_PAID';
      provider: string;
      providerEventId: string;
      lineUserId: string;
      providerSubscriptionId: string;
      cycleId: string;
      periodStart: Date;
      periodEnd: Date;
    }
  | {
      type: 'SUBSCRIPTION_CANCELLED';
      provider: string;
      providerEventId: string;
      lineUserId: string;
      providerSubscriptionId: string;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | {
      type: 'PAID_PACK_PURCHASED';
      provider: string;
      providerEventId: string;
      lineUserId: string;
      providerPurchaseId: string;
      packCode: PaidPackCode;
    };

export type CommerceApplyResult =
  | { status: 'APPLIED' | 'ALREADY_APPLIED'; operationId: number | null }
  | { status: 'USER_NOT_FOUND' | 'PRODUCT_NOT_CONFIGURED' | 'REFERENCE_CONFLICT' };

export interface CommerceRepository {
  findApplied(provider: string, providerEventId: string): Promise<null | { eventType: string; userId: number }>;
  recordApplied(input: {
    provider: string;
    providerEventId: string;
    eventType: CommerceEvent['type'];
    userId: number;
    payload: Record<string, unknown>;
    at: Date;
  }): Promise<'RECORDED' | 'ALREADY_RECORDED' | 'REFERENCE_CONFLICT'>;
  upsertSubscription(input: {
    userId: number;
    provider: string;
    providerSubscriptionId: string;
    status: 'ACTIVE' | 'CANCELLED';
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    at: Date;
  }): Promise<void>;
  recordSubscriptionCycle(input: {
    userId: number;
    provider: string;
    providerSubscriptionId: string;
    cycleId: string;
    periodStart: Date;
    periodEnd: Date;
    grantOperationId: number;
    at: Date;
  }): Promise<void>;
  recordPaidPurchase(input: {
    userId: number;
    provider: string;
    providerPurchaseId: string;
    packCode: PaidPackCode;
    grantOperationId: number;
    at: Date;
  }): Promise<void>;
}

type EnergyPort = Pick<DrizzleUserEnergyRepository, 'findUserId' | 'grant'>;

export class CommerceEventService {
  constructor(
    private readonly repository: CommerceRepository,
    private readonly energy: EnergyPort,
    private readonly product: ProductConfig,
  ) {}

  async apply(event: CommerceEvent, at = new Date()): Promise<CommerceApplyResult> {
    const provider = required(event.provider, 'provider', 32);
    const eventId = required(event.providerEventId, 'providerEventId', 160);
    const userId = await this.energy.findUserId(required(event.lineUserId, 'lineUserId', 64));
    if (userId === null) return { status: 'USER_NOT_FOUND' };

    const existing = await this.repository.findApplied(provider, eventId);
    if (existing) {
      return existing.eventType === event.type && existing.userId === userId
        ? { status: 'ALREADY_APPLIED', operationId: null }
        : { status: 'REFERENCE_CONFLICT' };
    }

    if (event.type === 'SUBSCRIPTION_CANCELLED') {
      await this.repository.upsertSubscription({
        userId,
        provider,
        providerSubscriptionId: required(event.providerSubscriptionId, 'providerSubscriptionId', 160),
        status: 'CANCELLED',
        currentPeriodEnd: event.currentPeriodEnd,
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        at,
      });
      const recorded = await this.repository.recordApplied({
        provider,
        providerEventId: eventId,
        eventType: event.type,
        userId,
        payload: { providerSubscriptionId: event.providerSubscriptionId },
        at,
      });
      return recorded === 'REFERENCE_CONFLICT'
        ? { status: 'REFERENCE_CONFLICT' }
        : { status: recorded === 'RECORDED' ? 'APPLIED' : 'ALREADY_APPLIED', operationId: null };
    }

    if (event.type === 'SUBSCRIPTION_CYCLE_PAID') {
      const units = this.product.energy.subscriptionCycleUnits;
      if (units === null) return { status: 'PRODUCT_NOT_CONFIGURED' };
      const subscriptionId = required(event.providerSubscriptionId, 'providerSubscriptionId', 160);
      const cycleId = required(event.cycleId, 'cycleId', 160);
      const grant = await this.energy.grant(subscriptionCycleGrant({
        userId,
        units,
        provider,
        subscriptionId,
        cycleId,
        periodStart: event.periodStart,
        periodEnd: event.periodEnd,
      }));
      if (grant.status === 'REFERENCE_CONFLICT') return { status: 'REFERENCE_CONFLICT' };
      if (grant.status === 'USER_NOT_FOUND' || grant.operationId === null) return { status: 'USER_NOT_FOUND' };
      await this.repository.recordSubscriptionCycle({
        userId,
        provider,
        providerSubscriptionId: subscriptionId,
        cycleId,
        periodStart: event.periodStart,
        periodEnd: event.periodEnd,
        grantOperationId: grant.operationId,
        at,
      });
      await this.repository.upsertSubscription({
        userId,
        provider,
        providerSubscriptionId: subscriptionId,
        status: 'ACTIVE',
        currentPeriodEnd: event.periodEnd,
        cancelAtPeriodEnd: false,
        at,
      });
      const recorded = await this.repository.recordApplied({
        provider,
        providerEventId: eventId,
        eventType: event.type,
        userId,
        payload: { cycleId, periodStart: event.periodStart.toISOString(), periodEnd: event.periodEnd.toISOString() },
        at,
      });
      if (recorded === 'REFERENCE_CONFLICT') return { status: 'REFERENCE_CONFLICT' };
      return {
        status: recorded === 'RECORDED' && grant.status === 'GRANTED' ? 'APPLIED' : 'ALREADY_APPLIED',
        operationId: grant.operationId,
      };
    }

    const units = this.product.energy.paidPacks[event.packCode];
    if (units === null) return { status: 'PRODUCT_NOT_CONFIGURED' };
    const purchaseId = required(event.providerPurchaseId, 'providerPurchaseId', 160);
    const grant = await this.energy.grant(paidPackGrant({
      userId,
      units,
      provider,
      providerPurchaseId: purchaseId,
      packCode: event.packCode,
    }));
    if (grant.status === 'REFERENCE_CONFLICT') return { status: 'REFERENCE_CONFLICT' };
    if (grant.status === 'USER_NOT_FOUND' || grant.operationId === null) return { status: 'USER_NOT_FOUND' };
    await this.repository.recordPaidPurchase({
      userId,
      provider,
      providerPurchaseId: purchaseId,
      packCode: event.packCode,
      grantOperationId: grant.operationId,
      at,
    });
    const recorded = await this.repository.recordApplied({
      provider,
      providerEventId: eventId,
      eventType: event.type,
      userId,
      payload: { providerPurchaseId: purchaseId, packCode: event.packCode },
      at,
    });
    if (recorded === 'REFERENCE_CONFLICT') return { status: 'REFERENCE_CONFLICT' };
    return {
      status: recorded === 'RECORDED' && grant.status === 'GRANTED' ? 'APPLIED' : 'ALREADY_APPLIED',
      operationId: grant.operationId,
    };
  }
}

function required(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${name} must contain 1-${maxLength} characters`);
  return normalized;
}
