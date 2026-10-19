import { providerCostToAiPoints } from './ai-points';
import type { WorklogAiUsageCommit } from './ai-provider-usage';

export type WorklogAiPointReservationStatus = 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

export type WorklogAiPointReservationSnapshot = {
  id: number;
  token: string;
  chargedUserId: number;
  actorUserId: number;
  sourceId: number;
  entitlementGrantId?: number | null;
  pointsReserved: number;
  pointsCommitted: number;
  platformSubsidizedPoints: number;
  /** Conservative paid-subscription provider-cost hold while status=RESERVED. */
  providerCostHoldTwd?: number | null;
  status: WorklogAiPointReservationStatus;
  expiresAt: Date;
};

export interface WorklogAiPointLedgerRepository {
  expireStaleReservations(input: { chargedUserId: number; sourceId: number; at: Date }): Promise<number>;
  reservePointsAtomic(input: {
    token: string;
    chargedUserId: number;
    actorUserId: number;
    sourceId: number;
    requestedPoints: number;
    entitlementGrantId?: number | null;
    providerCostHoldTwd?: number | null;
    at: Date;
    expiresAt: Date;
  }): Promise<WorklogAiPointReservationSnapshot | null>;
  getReservation(token: string): Promise<WorklogAiPointReservationSnapshot | null>;
  commitReservationAtomic(input: { token: string; usage: WorklogAiUsageCommit; actualPoints: number; at: Date }): Promise<WorklogAiPointReservationSnapshot | null>;
  releaseReservationAtomic(token: string, at: Date): Promise<WorklogAiPointReservationSnapshot | null>;
}

export type AiPointReservationResult =
  | { status: 'RESERVED'; reservation: WorklogAiPointReservationSnapshot; remainingAiPoints: number }
  | { status: 'AI_POINTS_EXHAUSTED' }
  | { status: 'AI_ENTITLEMENT_BLOCKED'; reason: string };

export type AiPointCommitResult =
  | { status: 'COMMITTED'; reservation: WorklogAiPointReservationSnapshot; actualPoints: number }
  | { status: 'RESERVATION_NOT_FOUND' | 'RESERVATION_NOT_ACTIVE' };

export type AiPointReleaseResult =
  | { status: 'RELEASED'; reservation: WorklogAiPointReservationSnapshot }
  | { status: 'RESERVATION_NOT_FOUND' | 'RESERVATION_NOT_ACTIVE' };

/** Low-level exactly-once Grant reservation/settlement service. */
export class WorklogAiPointLedgerService {
  constructor(
    private readonly repository: WorklogAiPointLedgerRepository,
    private readonly tokenFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedPoints: number;
    entitlementGrantId?: number | null;
    providerCostHoldTwd?: number | null;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiPointReservationResult> {
    const chargedUserId = positiveInteger(input.chargedUserId, 'chargedUserId');
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const requestedPoints = positiveInteger(input.requestedPoints, 'requestedPoints');
    const entitlementGrantId = optionalPositiveInteger(input.entitlementGrantId, 'entitlementGrantId');
    const providerCostHoldTwd = optionalNonNegativeFinite(input.providerCostHoldTwd, 'providerCostHoldTwd');
    const at = validDate(input.at ?? new Date(), 'at');
    const ttlMs = positiveInteger(input.ttlMs ?? 10 * 60_000, 'ttlMs');

    await this.repository.expireStaleReservations({ chargedUserId, sourceId, at });
    let reservation: WorklogAiPointReservationSnapshot | null;
    try {
      reservation = await this.repository.reservePointsAtomic({
        token: normalizeToken(this.tokenFactory()), chargedUserId, actorUserId, sourceId, requestedPoints,
        entitlementGrantId, providerCostHoldTwd, at, expiresAt: new Date(at.getTime() + ttlMs),
      });
    } catch (error) {
      const reason = providerCostReservationBlockReason(error);
      if (reason) return { status: 'AI_ENTITLEMENT_BLOCKED', reason };
      throw error;
    }
    if (!reservation || reservation.pointsReserved <= 0) return { status: 'AI_POINTS_EXHAUSTED' };
    return { status: 'RESERVED', reservation, remainingAiPoints: 0 };
  }

  async commitAiUsage(token: string, usage: WorklogAiUsageCommit, at = new Date()): Promise<AiPointCommitResult> {
    const normalizedToken = normalizeToken(token);
    const current = await this.repository.getReservation(normalizedToken);
    if (!current) return { status: 'RESERVATION_NOT_FOUND' };
    const actualPoints = providerCostToAiPoints({
      providerCostUsd: nonNegativeFinite(usage.providerCostUsd, 'providerCostUsd'),
      outputUsdPerMillion: positiveFinite(usage.outputUsdPerMillion, 'outputUsdPerMillion'),
    });
    if (current.status === 'COMMITTED') return { status: 'COMMITTED', reservation: current, actualPoints };
    if (current.status !== 'RESERVED' && current.status !== 'EXPIRED') return { status: 'RESERVATION_NOT_ACTIVE' };

    const committed = await this.repository.commitReservationAtomic({ token: normalizedToken, usage, actualPoints, at: validDate(at, 'at') });
    if (committed) return { status: 'COMMITTED', reservation: committed, actualPoints };
    const refreshed = await this.repository.getReservation(normalizedToken);
    if (!refreshed) return { status: 'RESERVATION_NOT_FOUND' };
    if (refreshed.status === 'COMMITTED') return { status: 'COMMITTED', reservation: refreshed, actualPoints };
    return { status: 'RESERVATION_NOT_ACTIVE' };
  }

  async releaseAi(token: string, at = new Date()): Promise<AiPointReleaseResult> {
    const normalizedToken = normalizeToken(token);
    const current = await this.repository.getReservation(normalizedToken);
    if (!current) return { status: 'RESERVATION_NOT_FOUND' };
    if (current.status !== 'RESERVED') return { status: 'RESERVATION_NOT_ACTIVE' };
    const released = await this.repository.releaseReservationAtomic(normalizedToken, validDate(at, 'at'));
    if (released) return { status: 'RELEASED', reservation: released };
    const refreshed = await this.repository.getReservation(normalizedToken);
    if (!refreshed) return { status: 'RESERVATION_NOT_FOUND' };
    return { status: 'RESERVATION_NOT_ACTIVE' };
  }
}

function providerCostReservationBlockReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'PAID_GRANT_NOT_READY') return 'AI_PRO_GRANT_NOT_READY';
  if (
    error.message === 'MONTHLY_PROVIDER_COST_CAP_REACHED'
    || error.message === 'PROVIDER_COST_ACCOUNTING_INCOMPLETE'
    || error.message === 'AI_PRO_GRANT_NOT_READY'
  ) return error.message;
  return null;
}

function positiveInteger(value: number | null | undefined, label: string): number { if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) throw new Error(`${label} must be a positive safe integer`); return value as number; }
function optionalPositiveInteger(value: number | null | undefined, label: string): number | null { return value == null ? null : positiveInteger(value, label); }
function nonNegativeFinite(value: number, label: string): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`); return value; }
function optionalNonNegativeFinite(value: number | null | undefined, label: string): number | null { return value == null ? null : nonNegativeFinite(value, label); }
function positiveFinite(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`); return value; }
function validDate(value: Date, label: string): Date { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`); return new Date(value.getTime()); }
function normalizeToken(value: string): string { const normalized = value.trim(); if (!normalized || normalized.length > 64) throw new Error('invalid AI reservation token'); return normalized; }
