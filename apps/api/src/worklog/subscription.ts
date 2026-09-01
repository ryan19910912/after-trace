import {
  canUseGroupCollaboration,
  parsePlanCapabilities,
  type PlanCapabilities,
} from './entitlements';

export type WorklogSubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
export type WorklogSubscriptionSource = 'FREE' | 'PAYMENT' | 'ADMIN';

export type WorklogPlanSnapshot = {
  code: string;
  displayName: string;
  enabled: boolean;
  aiAllowanceUnits: number;
  capabilities: unknown;
};

export type WorklogSubscriptionSnapshot = {
  userId: number;
  planCode: string;
  status: WorklogSubscriptionStatus;
  source: WorklogSubscriptionSource;
  effectiveAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  aiUnitsUsed: number;
  aiUnitsReserved: number;
  planEnabled: boolean;
  aiAllowanceUnits: number;
  capabilities: unknown;
};

export type WorklogAiReservationSnapshot = {
  token: string;
  chargedUserId: number;
  actorUserId: number;
  sourceId: number | null;
  unitsReserved: number;
  unitsCommitted: number;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  periodStart: Date;
  periodEnd: Date | null;
  expiresAt: Date;
};

export type WorklogAiUsageCommit = {
  actualUnits: number;
  workspaceId?: number | null;
  recordId?: number | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  audioInputUnits?: number;
  imageInputUnits?: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  audioUsdPerMillion?: number | null;
  imageUsdPerMillion?: number | null;
  usdTwdRate?: number | null;
  providerCostUsd: number;
  providerCostTwd?: number | null;
};

export interface WorklogSubscriptionRepository {
  getPlan(planCode: string): Promise<WorklogPlanSnapshot | null>;
  getCurrentSubscription(userId: number): Promise<WorklogSubscriptionSnapshot | null>;
  assignPlan(input: {
    userId: number;
    planCode: string;
    source: WorklogSubscriptionSource;
    actor: string | null;
    effectiveAt: Date;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<WorklogSubscriptionSnapshot | null>;
  expireStaleAiReservations(chargedUserId: number, at: Date): Promise<number>;
  reserveAiUnitsAtomic(input: {
    token: string;
    chargedUserId: number;
    actorUserId: number;
    sourceId: number | null;
    requestedUnits: number;
    at: Date;
    expiresAt: Date;
  }): Promise<WorklogAiReservationSnapshot | null>;
  getAiReservation(token: string): Promise<WorklogAiReservationSnapshot | null>;
  commitAiReservationAtomic(
    token: string,
    usage: WorklogAiUsageCommit,
    at: Date,
  ): Promise<WorklogAiReservationSnapshot | null>;
  releaseAiReservationAtomic(
    token: string,
    at: Date,
  ): Promise<WorklogAiReservationSnapshot | null>;
}

export type SubscriptionEntitlementResult =
  | {
      status: 'ACTIVE';
      userId: number;
      planCode: string;
      capabilities: PlanCapabilities;
      allowanceUnits: number;
      usedUnits: number;
      reservedUnits: number;
      remainingUnits: number;
      periodStart: Date;
      periodEnd: Date | null;
    }
  | {
      status:
        | 'NO_SUBSCRIPTION'
        | 'SUBSCRIPTION_INACTIVE'
        | 'PLAN_DISABLED'
        | 'NOT_YET_EFFECTIVE'
        | 'PERIOD_NOT_STARTED'
        | 'PERIOD_EXPIRED';
      planCode?: string;
    };

export type PlanAssignmentResult =
  | { status: 'ASSIGNED'; subscription: WorklogSubscriptionSnapshot }
  | { status: 'PLAN_NOT_AVAILABLE' };

export type GroupActivationResult =
  | {
      status: 'ALLOWED';
      planCode: string;
      capabilities: PlanCapabilities;
      remainingAiUnits: number;
    }
  | {
      status: 'NOT_ALLOWED';
      reason: Exclude<SubscriptionEntitlementResult['status'], 'ACTIVE'> | 'GROUP_CAPABILITY_DISABLED';
    };

export type AiReservationResult =
  | {
      status: 'RESERVED';
      reservation: WorklogAiReservationSnapshot;
      remainingAiUnits: number;
    }
  | {
      status:
        | 'NO_SUBSCRIPTION'
        | 'SUBSCRIPTION_INACTIVE'
        | 'PLAN_DISABLED'
        | 'NOT_YET_EFFECTIVE'
        | 'PERIOD_NOT_STARTED'
        | 'PERIOD_EXPIRED'
        | 'AI_QUOTA_EXHAUSTED';
    };

export type AiCommitResult =
  | { status: 'COMMITTED'; reservation: WorklogAiReservationSnapshot }
  | { status: 'RESERVATION_NOT_FOUND' | 'RESERVATION_NOT_ACTIVE' | 'ACTUAL_EXCEEDS_RESERVED' };

export type AiReleaseResult =
  | { status: 'RELEASED'; reservation: WorklogAiReservationSnapshot }
  | { status: 'RESERVATION_NOT_FOUND' | 'RESERVATION_NOT_ACTIVE' };

export class WorklogSubscriptionService {
  constructor(
    private readonly repository: WorklogSubscriptionRepository,
    private readonly tokenFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async getEntitlement(userId: number, at = new Date()): Promise<SubscriptionEntitlementResult> {
    const snapshot = await this.repository.getCurrentSubscription(userId);
    return evaluateSubscription(snapshot, at);
  }

  async assignPlan(input: {
    userId: number;
    planCode: string;
    source: WorklogSubscriptionSource;
    actor?: string | null;
    effectiveAt?: Date;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<PlanAssignmentResult> {
    const planCode = normalizePlanCode(input.planCode);
    const plan = await this.repository.getPlan(planCode);
    if (!plan?.enabled) return { status: 'PLAN_NOT_AVAILABLE' };

    const effectiveAt = cloneDate(input.effectiveAt ?? new Date());
    const currentPeriodStart = cloneDate(input.currentPeriodStart ?? effectiveAt);
    const currentPeriodEnd = input.currentPeriodEnd === undefined
      ? addOneCalendarMonth(currentPeriodStart)
      : input.currentPeriodEnd === null
        ? null
        : cloneDate(input.currentPeriodEnd);

    if (currentPeriodEnd !== null && currentPeriodEnd.getTime() <= currentPeriodStart.getTime()) {
      throw new Error('subscription period end must be after period start');
    }
    if (input.source === 'ADMIN' && !input.actor?.trim()) {
      throw new Error('admin plan assignment requires actor');
    }

    const subscription = await this.repository.assignPlan({
      userId: positiveInteger(input.userId, 'userId'),
      planCode,
      source: input.source,
      actor: input.actor?.trim() || null,
      effectiveAt,
      currentPeriodStart,
      currentPeriodEnd,
      metadata: input.metadata ?? null,
    });
    return subscription ? { status: 'ASSIGNED', subscription } : { status: 'PLAN_NOT_AVAILABLE' };
  }

  async checkGroupActivation(userId: number, at = new Date()): Promise<GroupActivationResult> {
    const entitlement = await this.getEntitlement(userId, at);
    if (entitlement.status !== 'ACTIVE') {
      return { status: 'NOT_ALLOWED', reason: entitlement.status };
    }
    if (!canUseGroupCollaboration(entitlement.planCode, entitlement.capabilities)) {
      return { status: 'NOT_ALLOWED', reason: 'GROUP_CAPABILITY_DISABLED' };
    }
    return {
      status: 'ALLOWED',
      planCode: entitlement.planCode,
      capabilities: entitlement.capabilities,
      remainingAiUnits: entitlement.remainingUnits,
    };
  }

  async reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedUnits: number;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiReservationResult> {
    const chargedUserId = positiveInteger(input.chargedUserId, 'chargedUserId');
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const requestedUnits = positiveInteger(input.requestedUnits, 'requestedUnits');
    const at = cloneDate(input.at ?? new Date());
    const ttlMs = positiveInteger(input.ttlMs ?? 5 * 60_000, 'ttlMs');

    await this.repository.expireStaleAiReservations(chargedUserId, at);

    const entitlement = await this.getEntitlement(chargedUserId, at);
    if (entitlement.status !== 'ACTIVE') return { status: entitlement.status };
    if (entitlement.remainingUnits < requestedUnits) return { status: 'AI_QUOTA_EXHAUSTED' };

    const reservation = await this.repository.reserveAiUnitsAtomic({
      token: this.tokenFactory(),
      chargedUserId,
      actorUserId,
      sourceId: input.sourceId == null ? null : positiveInteger(input.sourceId, 'sourceId'),
      requestedUnits,
      at,
      expiresAt: new Date(at.getTime() + ttlMs),
    });
    if (reservation) {
      return {
        status: 'RESERVED',
        reservation,
        remainingAiUnits: Math.max(0, entitlement.remainingUnits - requestedUnits),
      };
    }

    const refreshed = await this.getEntitlement(chargedUserId, at);
    if (refreshed.status !== 'ACTIVE') return { status: refreshed.status };
    return { status: 'AI_QUOTA_EXHAUSTED' };
  }

  async commitAiUsage(
    token: string,
    usage: WorklogAiUsageCommit,
    at = new Date(),
  ): Promise<AiCommitResult> {
    const normalized = normalizeUsageCommit(usage);
    const current = await this.repository.getAiReservation(token);
    if (!current) return { status: 'RESERVATION_NOT_FOUND' };
    if (current.status !== 'RESERVED') return { status: 'RESERVATION_NOT_ACTIVE' };
    if (normalized.actualUnits > current.unitsReserved) {
      return { status: 'ACTUAL_EXCEEDS_RESERVED' };
    }

    const committed = await this.repository.commitAiReservationAtomic(token, normalized, cloneDate(at));
    if (committed) return { status: 'COMMITTED', reservation: committed };

    const refreshed = await this.repository.getAiReservation(token);
    if (!refreshed) return { status: 'RESERVATION_NOT_FOUND' };
    return { status: 'RESERVATION_NOT_ACTIVE' };
  }

  async releaseAi(token: string, at = new Date()): Promise<AiReleaseResult> {
    const current = await this.repository.getAiReservation(token);
    if (!current) return { status: 'RESERVATION_NOT_FOUND' };
    if (current.status !== 'RESERVED') return { status: 'RESERVATION_NOT_ACTIVE' };

    const released = await this.repository.releaseAiReservationAtomic(token, cloneDate(at));
    if (released) return { status: 'RELEASED', reservation: released };
    return { status: 'RESERVATION_NOT_ACTIVE' };
  }
}

export function evaluateSubscription(
  snapshot: WorklogSubscriptionSnapshot | null,
  at: Date,
): SubscriptionEntitlementResult {
  if (!snapshot) return { status: 'NO_SUBSCRIPTION' };
  if (snapshot.status !== 'ACTIVE') {
    return { status: 'SUBSCRIPTION_INACTIVE', planCode: snapshot.planCode };
  }
  if (!snapshot.planEnabled) return { status: 'PLAN_DISABLED', planCode: snapshot.planCode };
  if (at.getTime() < snapshot.effectiveAt.getTime()) {
    return { status: 'NOT_YET_EFFECTIVE', planCode: snapshot.planCode };
  }
  if (at.getTime() < snapshot.currentPeriodStart.getTime()) {
    return { status: 'PERIOD_NOT_STARTED', planCode: snapshot.planCode };
  }
  if (snapshot.currentPeriodEnd !== null && at.getTime() >= snapshot.currentPeriodEnd.getTime()) {
    return { status: 'PERIOD_EXPIRED', planCode: snapshot.planCode };
  }

  const allowanceUnits = nonNegativeInteger(snapshot.aiAllowanceUnits, 'aiAllowanceUnits');
  const usedUnits = nonNegativeInteger(snapshot.aiUnitsUsed, 'aiUnitsUsed');
  const reservedUnits = nonNegativeInteger(snapshot.aiUnitsReserved, 'aiUnitsReserved');
  return {
    status: 'ACTIVE',
    userId: snapshot.userId,
    planCode: snapshot.planCode,
    capabilities: parsePlanCapabilities(snapshot.capabilities),
    allowanceUnits,
    usedUnits,
    reservedUnits,
    remainingUnits: Math.max(0, allowanceUnits - usedUnits - reservedUnits),
    periodStart: cloneDate(snapshot.currentPeriodStart),
    periodEnd: snapshot.currentPeriodEnd ? cloneDate(snapshot.currentPeriodEnd) : null,
  };
}

export function addOneCalendarMonth(value: Date): Date {
  const result = cloneDate(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function normalizePlanCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 64) throw new Error('invalid plan code');
  return normalized;
}

function normalizeUsageCommit(value: WorklogAiUsageCommit): WorklogAiUsageCommit {
  return {
    actualUnits: nonNegativeInteger(value.actualUnits, 'actualUnits'),
    workspaceId: value.workspaceId == null ? null : positiveInteger(value.workspaceId, 'workspaceId'),
    recordId: value.recordId == null ? null : positiveInteger(value.recordId, 'recordId'),
    provider: requiredText(value.provider, 'provider', 128),
    model: requiredText(value.model, 'model', 255),
    inputTokens: nonNegativeInteger(value.inputTokens, 'inputTokens'),
    outputTokens: nonNegativeInteger(value.outputTokens, 'outputTokens'),
    audioInputUnits: nonNegativeInteger(value.audioInputUnits ?? 0, 'audioInputUnits'),
    imageInputUnits: nonNegativeInteger(value.imageInputUnits ?? 0, 'imageInputUnits'),
    inputUsdPerMillion: nonNegativeFinite(value.inputUsdPerMillion, 'inputUsdPerMillion'),
    outputUsdPerMillion: nonNegativeFinite(value.outputUsdPerMillion, 'outputUsdPerMillion'),
    audioUsdPerMillion: optionalNonNegativeFinite(value.audioUsdPerMillion, 'audioUsdPerMillion'),
    imageUsdPerMillion: optionalNonNegativeFinite(value.imageUsdPerMillion, 'imageUsdPerMillion'),
    usdTwdRate: optionalNonNegativeFinite(value.usdTwdRate, 'usdTwdRate'),
    providerCostUsd: nonNegativeFinite(value.providerCostUsd, 'providerCostUsd'),
    providerCostTwd: optionalNonNegativeFinite(value.providerCostTwd, 'providerCostTwd'),
  };
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid ${name}`);
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
  return value;
}

function optionalNonNegativeFinite(
  value: number | null | undefined,
  name: string,
): number | null {
  return value == null ? null : nonNegativeFinite(value, name);
}

function cloneDate(value: Date): Date {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('invalid date');
  return new Date(timestamp);
}
