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
    | 'MONTHLY_PROVIDER_COST_CAP_REACHED'
    | 'PLAN_DISABLED';
  remainingPoints: number | null;
  periodEndsAt: string | null;
};

export type AiEntitlementSnapshot = {
  sourceAuthorized: boolean;
  freeTrial: null | {
    grantId: number;
    remainingPoints: number;
  };
  aiPro: null | {
    planEnabled: boolean;
    aiEnabled: boolean;
    grantId: number | null;
    periodStart: Date;
    periodEnd: Date;
    monthlyPointCap: number;
    monthlyProviderCostCapTwd: number;
    pointsUsed: number;
    providerCostTwd: number;
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
 */
export class AiEntitlementService {
  constructor(private readonly repository: AiEntitlementRepository) {}

  async resolve(userId: number, sourceId: number, at = new Date()): Promise<AiEntitlementDecision> {
    validId(userId, 'INVALID_USER_ID');
    validId(sourceId, 'INVALID_SOURCE_ID');
    validDate(at);
    const snapshot = await this.repository.snapshot(userId, sourceId, at);
    if (!snapshot.sourceAuthorized) return blocked('SOURCE_NOT_AUTHORIZED');

    const paid = snapshot.aiPro;
    if (paid) {
      if (!paid.planEnabled || !paid.aiEnabled) return blocked('PLAN_DISABLED', paid.periodEnd);
      if (paid.pointsUsed >= paid.monthlyPointCap) {
        return blocked('MONTHLY_POINT_CAP_REACHED', paid.periodEnd, 0);
      }
      if (paid.providerCostTwd >= paid.monthlyProviderCostCapTwd) {
        return blocked('MONTHLY_PROVIDER_COST_CAP_REACHED', paid.periodEnd, Math.max(0, paid.monthlyPointCap - paid.pointsUsed));
      }
      if (paid.grantId) await this.repository.ensureGrantScope(paid.grantId, sourceId, at);
      return {
        source: 'AI_PRO',
        allowed: true,
        reason: 'AI_PRO_AVAILABLE',
        remainingPoints: Math.max(0, paid.monthlyPointCap - paid.pointsUsed),
        periodEndsAt: paid.periodEnd.toISOString(),
      };
    }

    const trial = snapshot.freeTrial;
    if (trial) {
      if (trial.remainingPoints <= 0) return blocked('TRIAL_EXHAUSTED', null, 0);
      await this.repository.ensureGrantScope(trial.grantId, sourceId, at);
      return {
        source: 'FREE_TRIAL',
        allowed: true,
        reason: 'FREE_TRIAL_AVAILABLE',
        remainingPoints: trial.remainingPoints,
        periodEndsAt: null,
      };
    }
    return blocked('AI_NOT_ENTITLED');
  }
}

function blocked(
  reason: AiEntitlementDecision['reason'],
  periodEnd: Date | null = null,
  remainingPoints: number | null = null,
): AiEntitlementDecision {
  return {
    source: 'BLOCKED',
    allowed: false,
    reason,
    remainingPoints,
    periodEndsAt: periodEnd?.toISOString() ?? null,
  };
}

function validId(value: number, error: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
}

function validDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('INVALID_ENTITLEMENT_TIME');
}
