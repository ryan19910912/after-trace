import { providerCostToAiPoints } from './ai-points';
import type { WorklogAiUsageCommit } from './ai-provider-usage';

export type WorklogAiPointReservationStatus = 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

export type WorklogAiPointReservationSnapshot = {
  id: number;
  token: string;
  chargedUserId: number;
  actorUserId: number;
  sourceId: number;
  pointsReserved: number;
  pointsCommitted: number;
  platformSubsidizedPoints: number;
  status: WorklogAiPointReservationStatus;
  expiresAt: Date;
};

export interface WorklogAiPointLedgerRepository {
  expireStaleReservations(input: {
    chargedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<number>;

  reservePointsAtomic(input: {
    token: string;
    chargedUserId: number;
    actorUserId: number;
    sourceId: number;
    requestedPoints: number;
    at: Date;
    expiresAt: Date;
  }): Promise<WorklogAiPointReservationSnapshot | null>;

  getReservation(token: string): Promise<WorklogAiPointReservationSnapshot | null>;

  commitReservationAtomic(input: {
    token: string;
    usage: WorklogAiUsageCommit;
    actualPoints: number;
    at: Date;
  }): Promise<WorklogAiPointReservationSnapshot | null>;

  releaseReservationAtomic(
    token: string,
    at: Date,
  ): Promise<WorklogAiPointReservationSnapshot | null>;
}

export type AiPointReservationResult =
  | {
      status: 'RESERVED';
      reservation: WorklogAiPointReservationSnapshot;
      remainingAiPoints: number;
    }
  | { status: 'AI_POINTS_EXHAUSTED' }
  | { status: 'AI_ENTITLEMENT_BLOCKED'; reason: string };

export type AiPointCommitResult =
  | {
      status: 'COMMITTED';
      reservation: WorklogAiPointReservationSnapshot;
      actualPoints: number;
    }
  | { status: 'RESERVATION_NOT_FOUND' | 'RESERVATION_NOT_ACTIVE' };

export type AiPointReleaseResult =
  | { status: 'RELEASED'; reservation: WorklogAiPointReservationSnapshot }
  | { status: 'RESERVATION_NOT_FOUND' | 'RESERVATION_NOT_ACTIVE' };

/**
 * Low-level exactly-once Grant reservation/settlement service.
 *
 * Product/provider admission belongs in AiEntitlementService (or the entitled wrapper)
 * before this ledger is called. This class intentionally retains generic Grant mechanics,
 * including bounded platform-subsidy settlement when actual provider usage exceeds a hold.
 * The entitlement layer is responsible for activating only the selected user-owned Grant
 * scope for the requested Source before delegation reaches this ledger.
 */
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
    at?: Date;
    ttlMs?: number;
  }): Promise<AiPointReservationResult> {
    const chargedUserId = positiveInteger(input.chargedUserId, 'chargedUserId');
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const requestedPoints = positiveInteger(input.requestedPoints, 'requestedPoints');
    const at = validDate(input.at ?? new Date(), 'at');
    const ttlMs = positiveInteger(input.ttlMs ?? 10 * 60_000, 'ttlMs');

    await this.repository.expireStaleReservations({ chargedUserId, sourceId, at });
    const reservation = await this.repository.reservePointsAtomic({
      token: normalizeToken(this.tokenFactory()),
      chargedUserId,
      actorUserId,
      sourceId,
      requestedPoints,
      at,
      expiresAt: new Date(at.getTime() + ttlMs),
    });
    if (!reservation || reservation.pointsReserved <= 0) return { status: 'AI_POINTS_EXHAUSTED' };

    return {
      status: 'RESERVED',
      reservation,
      // The authoritative post-hold balance is intentionally not re-read here; callers
      // only need to know that a positive scoped hold exists before provider execution.
      remainingAiPoints: 0,
    };
  }

  async commitAiUsage(
    token: string,
    usage: WorklogAiUsageCommit,
    at = new Date(),
  ): Promise<AiPointCommitResult> {
    const normalizedToken = normalizeToken(token);
    const current = await this.repository.getReservation(normalizedToken);
    if (!current) return { status: 'RESERVATION_NOT_FOUND' };
    if (current.status === 'COMMITTED') {
      const actualPoints = providerCostToAiPoints({
        providerCostUsd: nonNegativeFinite(usage.providerCostUsd, 'providerCostUsd'),
        outputUsdPerMillion: positiveFinite(usage.outputUsdPerMillion, 'outputUsdPerMillion'),
      });
      return { status: 'COMMITTED', reservation: current, actualPoints };
    }
    if (current.status !== 'RESERVED' && current.status !== 'EXPIRED') {
      return { status: 'RESERVATION_NOT_ACTIVE' };
    }

    const actualPoints = providerCostToAiPoints({
      providerCostUsd: nonNegativeFinite(usage.providerCostUsd, 'providerCostUsd'),
      outputUsdPerMillion: positiveFinite(usage.outputUsdPerMillion, 'outputUsdPerMillion'),
    });
    const committed = await this.repository.commitReservationAtomic({
      token: normalizedToken,
      usage,
      actualPoints,
      at: validDate(at, 'at'),
    });
    if (committed) return { status: 'COMMITTED', reservation: committed, actualPoints };

    const refreshed = await this.repository.getReservation(normalizedToken);
    if (!refreshed) return { status: 'RESERVATION_NOT_FOUND' };
    if (refreshed.status === 'COMMITTED') {
      return { status: 'COMMITTED', reservation: refreshed, actualPoints };
    }
    return { status: 'RESERVATION_NOT_ACTIVE' };
  }

  async releaseAi(token: string, at = new Date()): Promise<AiPointReleaseResult> {
    const normalizedToken = normalizeToken(token);
    const current = await this.repository.getReservation(normalizedToken);
    if (!current) return { status: 'RESERVATION_NOT_FOUND' };
    if (current.status !== 'RESERVED') return { status: 'RESERVATION_NOT_ACTIVE' };

    const released = await this.repository.releaseReservationAtomic(
      normalizedToken,
      validDate(at, 'at'),
    );
    if (released) return { status: 'RELEASED', reservation: released };

    const refreshed = await this.repository.getReservation(normalizedToken);
    if (!refreshed) return { status: 'RESERVATION_NOT_FOUND' };
    return { status: 'RESERVATION_NOT_ACTIVE' };
  }
}

function positiveInteger(value: number | null | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid date`);
  return new Date(value.getTime());
}

function normalizeToken(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) throw new Error('invalid AI reservation token');
  return normalized;
}
