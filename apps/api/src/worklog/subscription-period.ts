export type WorklogSubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
export type WorklogSubscriptionSource = 'FREE' | 'PAYMENT' | 'ADMIN';

export type WorklogSubscriptionPlanTemplate = {
  code: string;
  displayName: string;
  enabled: boolean;
  priceTwd: number;
  subscriptionPeriodPoints: number;
};

export type WorklogSubscriptionPeriodSnapshot = {
  userId: number;
  planCode: string;
  status: WorklogSubscriptionStatus;
  source: WorklogSubscriptionSource;
  effectiveAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  planEnabled: boolean;
};

export type WorklogSubscriptionPeriodGrantSnapshot = {
  grantId: number;
  originalPoints: number;
  remainingPoints: number;
  effectiveAt: Date;
  expiresAt: Date | null;
  originKey: string;
};

export interface WorklogSubscriptionPeriodRepository {
  getPlan(planCode: string): Promise<WorklogSubscriptionPlanTemplate | null>;
  getCurrentSubscription(userId: number): Promise<WorklogSubscriptionPeriodSnapshot | null>;
  getPrivateSourceId(userId: number): Promise<number | null>;
  getGrantByOrigin(input: {
    ownerUserId: number;
    originKey: string;
  }): Promise<WorklogSubscriptionPeriodGrantSnapshot | null>;
  assignPeriodAtomic(input: {
    userId: number;
    planCode: string;
    source: WorklogSubscriptionSource;
    actor: string | null;
    effectiveAt: Date;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    privateSourceId: number | null;
    subscriptionPeriodPoints: number;
    originKey: string | null;
    metadata: Record<string, unknown>;
  }): Promise<{
    subscription: WorklogSubscriptionPeriodSnapshot;
    grant: WorklogSubscriptionPeriodGrantSnapshot | null;
  } | null>;
}

export type WorklogSubscriptionPeriodAssignmentResult =
  | {
      status: 'ASSIGNED';
      subscription: WorklogSubscriptionPeriodSnapshot;
      grant: WorklogSubscriptionPeriodGrantSnapshot | null;
      idempotent: boolean;
    }
  | { status: 'PLAN_NOT_AVAILABLE' }
  | { status: 'ACTIVE_PERIOD_EXISTS'; subscription: WorklogSubscriptionPeriodSnapshot }
  | { status: 'ACTIVE_PERIOD_CHANGE_POLICY_UNDEFINED'; subscription: WorklogSubscriptionPeriodSnapshot }
  | { status: 'PRIVATE_SOURCE_NOT_FOUND' };

/**
 * Subscription lifecycle is intentionally separate from AI point accounting.
 *
 * A successful paid period freezes the plan template's included points into one
 * immutable SUBSCRIPTION_PERIOD grant. FREE does not create a recurring grant here;
 * its frozen one-time 400,000-point launch grant is provisioned by WorklogAiGrantService.
 * GROUP scopes are never created here: subscription-period points are automatically
 * scoped only to the user's PRIVATE Source and may later be explicitly allocated to a
 * selected GROUP by the AI 額度負責人.
 */
export class WorklogSubscriptionPeriodService {
  constructor(private readonly repository: WorklogSubscriptionPeriodRepository) {}

  async assignPeriod(input: {
    userId: number;
    planCode: string;
    source: WorklogSubscriptionSource;
    actor?: string | null;
    /** Evaluation time for an existing lifecycle row. Kept separate from effectiveAt for deterministic tests/webhooks. */
    at?: Date;
    effectiveAt?: Date;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<WorklogSubscriptionPeriodAssignmentResult> {
    const userId = positiveInteger(input.userId, 'userId');
    const planCode = normalizePlanCode(input.planCode);
    const plan = await this.repository.getPlan(planCode);
    if (!plan?.enabled) return { status: 'PLAN_NOT_AVAILABLE' };

    const actor = input.actor?.trim() || null;
    if (input.source === 'ADMIN' && !actor) throw new Error('admin period assignment requires actor');

    const at = validDate(input.at ?? new Date(), 'at');
    const effectiveAt = validDate(input.effectiveAt ?? at, 'effectiveAt');
    const current = await this.repository.getCurrentSubscription(userId);
    const currentState = current ? evaluateSubscriptionPeriod(current, at) : 'NO_SUBSCRIPTION';
    if (current && currentState === 'ACTIVE') {
      if (current.planCode !== planCode) {
        return { status: 'ACTIVE_PERIOD_CHANGE_POLICY_UNDEFINED', subscription: current };
      }

      const retryGrant = await this.resolveActivePeriodRetry({
        userId,
        plan,
        current,
        source: input.source,
        requestedStart: input.currentPeriodStart,
        requestedEnd: input.currentPeriodEnd,
      });
      if (retryGrant !== undefined) {
        return {
          status: 'ASSIGNED',
          subscription: current,
          grant: retryGrant,
          idempotent: true,
        };
      }
      return { status: 'ACTIVE_PERIOD_EXISTS', subscription: current };
    }

    const currentPeriodStart = validDate(input.currentPeriodStart ?? effectiveAt, 'currentPeriodStart');
    const currentPeriodEnd = input.currentPeriodEnd === undefined
      ? (plan.priceTwd > 0 ? addOneCalendarMonth(currentPeriodStart) : null)
      : input.currentPeriodEnd === null
        ? null
        : validDate(input.currentPeriodEnd, 'currentPeriodEnd');
    validatePeriod(plan, currentPeriodStart, currentPeriodEnd);

    const subscriptionPeriodPoints = nonNegativeInteger(plan.subscriptionPeriodPoints, 'subscriptionPeriodPoints');
    const createsPaidGrant = plan.priceTwd > 0 && subscriptionPeriodPoints > 0;
    const privateSourceId = createsPaidGrant ? await this.repository.getPrivateSourceId(userId) : null;
    if (createsPaidGrant && privateSourceId === null) return { status: 'PRIVATE_SOURCE_NOT_FOUND' };

    const originKey = createsPaidGrant
      ? subscriptionPeriodOriginKey({ userId, planCode, source: input.source, currentPeriodStart })
      : null;
    const metadata = subscriptionPeriodMetadata({
      metadata: input.metadata,
      plan,
      planCode,
      currentPeriodStart,
      currentPeriodEnd,
    });

    const assigned = await this.repository.assignPeriodAtomic({
      userId,
      planCode,
      source: input.source,
      actor,
      effectiveAt,
      currentPeriodStart,
      currentPeriodEnd,
      privateSourceId,
      subscriptionPeriodPoints: createsPaidGrant ? subscriptionPeriodPoints : 0,
      originKey,
      metadata,
    });
    if (!assigned) return { status: 'PLAN_NOT_AVAILABLE' };
    return { status: 'ASSIGNED', ...assigned, idempotent: false };
  }

  private async resolveActivePeriodRetry(input: {
    userId: number;
    plan: WorklogSubscriptionPlanTemplate;
    current: WorklogSubscriptionPeriodSnapshot;
    source: WorklogSubscriptionSource;
    requestedStart?: Date;
    requestedEnd?: Date | null;
  }): Promise<WorklogSubscriptionPeriodGrantSnapshot | null | undefined> {
    const requestedStart = input.requestedStart === undefined
      ? null
      : validDate(input.requestedStart, 'currentPeriodStart');
    const requestedEnd = input.requestedEnd === undefined
      ? undefined
      : input.requestedEnd === null
        ? null
        : validDate(input.requestedEnd, 'currentPeriodEnd');

    // A retry must identify the exact active period. A plan-only ADMIN click is not
    // enough evidence to infer that an old lifecycle row already has its frozen grant.
    if (
      requestedStart === null
      || requestedStart.getTime() !== input.current.currentPeriodStart.getTime()
      || requestedEnd === undefined
      || !sameNullableDate(requestedEnd, input.current.currentPeriodEnd)
    ) {
      return undefined;
    }

    const points = nonNegativeInteger(input.plan.subscriptionPeriodPoints, 'subscriptionPeriodPoints');
    if (input.plan.priceTwd <= 0 || points === 0) return null;

    const originKey = subscriptionPeriodOriginKey({
      userId: input.userId,
      planCode: input.current.planCode,
      source: input.source,
      currentPeriodStart: input.current.currentPeriodStart,
    });
    const grant = await this.repository.getGrantByOrigin({
      ownerUserId: input.userId,
      originKey,
    });
    if (!grant) return undefined;
    if (
      grant.originalPoints !== points
      || grant.effectiveAt.getTime() !== input.current.currentPeriodStart.getTime()
      || !sameNullableDate(grant.expiresAt, input.current.currentPeriodEnd)
    ) {
      return undefined;
    }
    return grant;
  }
}

export function evaluateSubscriptionPeriod(
  snapshot: WorklogSubscriptionPeriodSnapshot,
  at: Date,
): 'ACTIVE' | 'SUBSCRIPTION_INACTIVE' | 'PLAN_DISABLED' | 'NOT_YET_EFFECTIVE' | 'PERIOD_NOT_STARTED' | 'PERIOD_EXPIRED' {
  if (snapshot.status !== 'ACTIVE') return 'SUBSCRIPTION_INACTIVE';
  if (!snapshot.planEnabled) return 'PLAN_DISABLED';
  if (at.getTime() < snapshot.effectiveAt.getTime()) return 'NOT_YET_EFFECTIVE';
  if (at.getTime() < snapshot.currentPeriodStart.getTime()) return 'PERIOD_NOT_STARTED';
  if (snapshot.currentPeriodEnd !== null && at.getTime() >= snapshot.currentPeriodEnd.getTime()) return 'PERIOD_EXPIRED';
  return 'ACTIVE';
}

export function subscriptionPeriodOriginKey(input: {
  userId: number;
  planCode: string;
  source: WorklogSubscriptionSource;
  currentPeriodStart: Date;
}): string {
  return `subscription-period:${input.source.toLowerCase()}:${positiveInteger(input.userId, 'userId')}:${normalizePlanCode(input.planCode)}:${validDate(input.currentPeriodStart, 'currentPeriodStart').toISOString()}`;
}

export function addOneCalendarMonth(value: Date): Date {
  const result = validDate(value, 'date');
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function subscriptionPeriodMetadata(input: {
  metadata?: Record<string, unknown> | null;
  plan: WorklogSubscriptionPlanTemplate;
  planCode: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
}): Record<string, unknown> {
  return {
    ...(input.metadata ?? {}),
    grantPolicy: 'SUBSCRIPTION_PERIOD_V1',
    planCode: input.planCode,
    planDisplayName: input.plan.displayName,
    priceTwd: input.plan.priceTwd,
    includedAiPoints: nonNegativeInteger(input.plan.subscriptionPeriodPoints, 'subscriptionPeriodPoints'),
    periodStart: input.currentPeriodStart.toISOString(),
    periodEnd: input.currentPeriodEnd?.toISOString() ?? null,
  };
}

function validatePeriod(
  plan: WorklogSubscriptionPlanTemplate,
  start: Date,
  end: Date | null,
): void {
  if (end !== null && end.getTime() <= start.getTime()) {
    throw new Error('subscription period end must be after period start');
  }
  if (plan.priceTwd > 0 && end === null) throw new Error('paid subscription period requires period end');
}

function sameNullableDate(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

function normalizePlanCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) throw new Error('invalid plan code');
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}
