import { FREE_INITIAL_GRANT_ORIGIN_KEY } from './ai-points';

export type WorklogAiGrantType = 'FREE_INITIAL' | 'SUBSCRIPTION_PERIOD' | 'ADMIN';
export type WorklogAiGrantStatus = 'ACTIVE' | 'EXHAUSTED' | 'REVOKED';

export type WorklogAiGrantSnapshot = {
  id: number;
  ownerUserId: number;
  type: WorklogAiGrantType;
  status: WorklogAiGrantStatus;
  originalPoints: number;
  remainingPoints: number;
  effectiveAt: Date;
  expiresAt: Date | null;
  originKey: string;
};

export type WorklogAiEligibleBalance = {
  ownerUserId: number;
  sourceId: number;
  totalRemainingPoints: number;
  grants: Array<{
    grantId: number;
    grantScopeId: number;
    remainingPoints: number;
    scopeRemainingPoints: number;
    usablePoints: number;
    expiresAt: Date | null;
  }>;
};

export interface WorklogAiGrantRepository {
  getFreeInitialTrialPoints(): Promise<number | null>;

  ensureGrant(input: {
    ownerUserId: number;
    type: WorklogAiGrantType;
    originalPoints: number;
    effectiveAt: Date;
    expiresAt: Date | null;
    originKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<WorklogAiGrantSnapshot>;

  ensureScope(input: {
    grantId: number;
    sourceId: number;
    capPoints: number | null;
    at: Date;
  }): Promise<void>;

  eligibleBalance(input: {
    ownerUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogAiEligibleBalance>;
}

/** User-owned grant rules independent from subscription/group data authorization. */
export class WorklogAiGrantService {
  constructor(private readonly repository: WorklogAiGrantRepository) {}

  /**
   * Idempotently provisions the current Admin-configured FREE one-time trial and PRIVATE scope.
   * The quantity is snapshotted into the durable FREE_INITIAL grant when first issued. Later
   * Admin config changes affect only accounts that have not yet received this origin key.
   */
  async ensureInitialFreeGrant(input: {
    userId: number;
    privateSourceId: number;
    at?: Date;
  }): Promise<WorklogAiGrantSnapshot> {
    const userId = positiveInteger(input.userId, 'userId');
    const privateSourceId = positiveInteger(input.privateSourceId, 'privateSourceId');
    const at = validDate(input.at ?? new Date(), 'at');
    const freePoints = await this.repository.getFreeInitialTrialPoints();
    if (freePoints === null) throw new Error('FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED');
    if (!Number.isSafeInteger(freePoints) || freePoints < 0) throw new Error('FREE_AI_TRIAL_POINTS_INVALID');

    const grant = await this.repository.ensureGrant({
      ownerUserId: userId,
      type: 'FREE_INITIAL',
      originalPoints: freePoints,
      effectiveAt: at,
      expiresAt: null,
      originKey: FREE_INITIAL_GRANT_ORIGIN_KEY,
      metadata: {
        commercialConfigKey: 'free_initial_ai_trial_points',
        configuredTrialPoints: freePoints,
      },
    });
    await this.repository.ensureScope({
      grantId: grant.id,
      sourceId: privateSourceId,
      capPoints: null,
      at,
    });
    return grant;
  }

  async eligibleBalance(userId: number, sourceId: number, at = new Date()) {
    return this.repository.eligibleBalance({
      ownerUserId: positiveInteger(userId, 'userId'),
      sourceId: positiveInteger(sourceId, 'sourceId'),
      at: validDate(at, 'at'),
    });
  }

  async canStartAi(userId: number, sourceId: number, at = new Date()): Promise<boolean> {
    const balance = await this.eligibleBalance(userId, sourceId, at);
    return balance.totalRemainingPoints > 0;
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}
