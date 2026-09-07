export type AiEntitlementSource = 'FREE_TRIAL' | 'AI_PRO' | 'BLOCKED';

export type AiEntitlementDecision = {
  source: AiEntitlementSource;
  allowed: boolean;
  reason:
    | 'FREE_TRIAL_AVAILABLE'
    | 'AI_PRO_AVAILABLE'
    | 'SOURCE_NOT_AUTHORIZED'
    | 'AI_NOT_ENTITLED'
    | 'TRIAL_EXHAUSTED'
    | 'MONTHLY_POINT_CAP_REACHED'
    | 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED'
    | 'MONTHLY_PROVIDER_COST_CAP_REACHED'
    | 'PROVIDER_COST_ACCOUNTING_INCOMPLETE'
    | 'AI_PRO_GRANT_NOT_READY'
    | 'PER_REQUEST_POINT_CAP_EXCEEDED'
    | 'PLAN_DISABLED';
  remainingPoints: number | null;
  periodEndsAt: string | null;
  perRequestAiPointCap: number | null;
};

export type AiEntitlementAdmission = {
  decision: AiEntitlementDecision;
  /** Internal settlement target only. Never expose this as customer identity/balance. */
  grantId: number | null;
};

export type AiEntitlementSnapshot = {
  sourceAuthorized: boolean;
  freeTrial: null | {
    grantId: number;
    remainingPoints: number;
    perRequestAiPointCap: number | null;
  };
  aiPro: null | {
    planEnabled: boolean;
    aiEnabled: boolean;
    grantId: number | null;
    periodStart: Date;
    periodEnd: Date;
    monthlyPointCap: number;
    monthlyProviderCostCapTwd: number;
    perRequestAiPointCap: number | null;
    pointsUsed: number;
    providerCostTwd: number;
    missingProviderCostTwdRequests: number;
  };
};

export interface AiEntitlementRepository {
  snapshot(userId: number, sourceId: number, at: Date): Promise<AiEntitlementSnapshot>;
  ensureGrantScope(grantId: number, sourceId: number, at: Date): Promise<void>;
}

/**
 * One provider-AI admission boundary shared by Web/PWA/GROUP/Chrome clients.
 * Source authorization is checked first. Entitlement always belongs to the requesting user;
 * GROUP membership never transfers or sponsors another user's AI allowance.
 *
 * resolve() is read-only and suitable for UI state. admit()/admitWithGrant() are provider
 * preflight paths: they enforce request/period caps and only then ensure the exact selected
 * user-owned grant scope for the authorized Source.
 */
export class AiEntitlementService {
  constructor(private readonly repository: AiEntitlementRepository) {}

  async resolve(userId: number, sourceId: number, at = new Date()): Promise<AiEntitlementDecision> {
    const normalized = normalizedInput(userId, sourceId, at);
    const snapshot = await this.repository.snapshot(normalized.userId, normalized.sourceId, normalized.at);
    return evaluate(snapshot).decision;
  }

  async admit(
    userId: number,
    sourceId: number,
    requestedPoints: number,
    at = new Date(),
  ): Promise<AiEntitlementDecision> {
    return (await this.admitWithGrant(userId, sourceId, requestedPoints, at)).decision;
  }

  async admitWithGrant(
    userId: number,
    sourceId: number,
    requestedPoints: number,
    at = new Date(),
  ): Promise<AiEntitlementAdmission> {
    const normalized = normalizedInput(userId, sourceId, at);
    if (!Number.isSafeInteger(requestedPoints) || requestedPoints <= 0) {
      throw new Error('INVALID_REQUESTED_AI_POINTS');
    }
    const snapshot = await this.repository.snapshot(normalized.userId, normalized.sourceId, normalized.at);
    const evaluated = evaluate(snapshot);
    if (!evaluated.decision.allowed || evaluated.grantId === null) {
      return { decision: evaluated.decision, grantId: null };
    }
    const requestCap = evaluated.decision.perRequestAiPointCap;
    if (requestCap !== null && requestedPoints > requestCap) {
      return {
        decision: {
          ...evaluated.decision,
          source: 'BLOCKED',
          allowed: false,
          reason: 'PER_REQUEST_POINT_CAP_EXCEEDED',
        },
        grantId: null,
      };
    }
    if (
      evaluated.decision.source === 'AI_PRO'
      && evaluated.decision.remainingPoints !== null
      && requestedPoints > evaluated.decision.remainingPoints
    ) {
      return {
        decision: {
          ...evaluated.decision,
          source: 'BLOCKED',
          allowed: false,
          reason: 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED',
        },
        grantId: null,
      };
    }
    await this.repository.ensureGrantScope(evaluated.grantId, normalized.sourceId, normalized.at);
    return { decision: evaluated.decision, grantId: evaluated.grantId };
  }
}

function evaluate(snapshot: AiEntitlementSnapshot): { decision: AiEntitlementDecision; grantId: number | null } {
  if (!snapshot.sourceAuthorized) return { decision: blocked('SOURCE_NOT_AUTHORIZED'), grantId: null };

  const paid = snapshot.aiPro;
  if (paid) {
    if (!paid.planEnabled || !paid.aiEnabled) {
      return { decision: blocked('PLAN_DISABLED', paid.periodEnd, null, paid.perRequestAiPointCap), grantId: null };
    }
    if (paid.missingProviderCostTwdRequests > 0) {
      return {
        decision: blocked(
          'PROVIDER_COST_ACCOUNTING_INCOMPLETE',
          paid.periodEnd,
          Math.max(0, paid.monthlyPointCap - paid.pointsUsed),
          paid.perRequestAiPointCap,
        ),
        grantId: null,
      };
    }
    if (paid.pointsUsed >= paid.monthlyPointCap) {
      return { decision: blocked('MONTHLY_POINT_CAP_REACHED', paid.periodEnd, 0, paid.perRequestAiPointCap), grantId: null };
    }
    if (paid.providerCostTwd >= paid.monthlyProviderCostCapTwd) {
      return {
        decision: blocked(
          'MONTHLY_PROVIDER_COST_CAP_REACHED',
          paid.periodEnd,
          Math.max(0, paid.monthlyPointCap - paid.pointsUsed),
          paid.perRequestAiPointCap,
        ),
        grantId: null,
      };
    }
    if (!paid.grantId) {
      return {
        decision: blocked(
          'AI_PRO_GRANT_NOT_READY',
          paid.periodEnd,
          Math.max(0, paid.monthlyPointCap - paid.pointsUsed),
          paid.perRequestAiPointCap,
        ),
        grantId: null,
      };
    }
    return {
      decision: {
        source: 'AI_PRO',
        allowed: true,
        reason: 'AI_PRO_AVAILABLE',
        remainingPoints: Math.max(0, paid.monthlyPointCap - paid.pointsUsed),
        periodEndsAt: paid.periodEnd.toISOString(),
        perRequestAiPointCap: paid.perRequestAiPointCap,
      },
      grantId: paid.grantId,
    };
  }

  const trial = snapshot.freeTrial;
  if (trial) {
    if (trial.remainingPoints <= 0) {
      return { decision: blocked('TRIAL_EXHAUSTED', null, 0, trial.perRequestAiPointCap), grantId: null };
    }
    return {
      decision: {
        source: 'FREE_TRIAL',
        allowed: true,
        reason: 'FREE_TRIAL_AVAILABLE',
        remainingPoints: trial.remainingPoints,
        periodEndsAt: null,
        perRequestAiPointCap: trial.perRequestAiPointCap,
      },
      grantId: trial.grantId,
    };
  }
  return { decision: blocked('AI_NOT_ENTITLED'), grantId: null };
}

function blocked(
  reason: AiEntitlementDecision['reason'],
  periodEnd: Date | null = null,
  remainingPoints: number | null = null,
  perRequestAiPointCap: number | null = null,
): AiEntitlementDecision {
  return {
    source: 'BLOCKED',
    allowed: false,
    reason,
    remainingPoints,
    periodEndsAt: periodEnd?.toISOString() ?? null,
    perRequestAiPointCap,
  };
}

function normalizedInput(userId: number, sourceId: number, at: Date) {
  validId(userId, 'INVALID_USER_ID');
  validId(sourceId, 'INVALID_SOURCE_ID');
  validDate(at);
  return { userId, sourceId, at: new Date(at.getTime()) };
}

function validId(value: number, error: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
}

function validDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_ENTITLEMENT_TIME');
}
