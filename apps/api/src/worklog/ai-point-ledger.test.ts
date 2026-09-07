import { describe, expect, it, vi } from 'vitest';
import type {
  WorklogAiPointLedgerRepository,
  WorklogAiPointReservationSnapshot,
} from './ai-point-ledger';
import { WorklogAiPointLedgerService } from './ai-point-ledger';

const now = new Date('2026-09-04T00:00:00.000Z');

function snapshot(
  status: WorklogAiPointReservationSnapshot['status'] = 'RESERVED',
  overrides: Partial<WorklogAiPointReservationSnapshot> = {},
): WorklogAiPointReservationSnapshot {
  return {
    id: 1,
    token: 'reservation-1',
    chargedUserId: 9,
    actorUserId: 7,
    sourceId: 20,
    entitlementGrantId: 44,
    pointsReserved: 25,
    pointsCommitted: status === 'COMMITTED' ? 25 : 0,
    platformSubsidizedPoints: 0,
    providerCostHoldTwd: 0.25,
    status,
    expiresAt: new Date(now.getTime() + 600_000),
    ...overrides,
  };
}

function repository(): WorklogAiPointLedgerRepository {
  return {
    expireStaleReservations: vi.fn().mockResolvedValue(0),
    reservePointsAtomic: vi.fn().mockResolvedValue(snapshot()),
    getReservation: vi.fn().mockResolvedValue(snapshot()),
    commitReservationAtomic: vi.fn().mockResolvedValue(snapshot('COMMITTED')),
    releaseReservationAtomic: vi.fn().mockResolvedValue(snapshot('RELEASED')),
  };
}

const usage = {
  workspaceId: null,
  recordId: 33,
  operation: 'TEXT_RECORD_CREATE',
  provider: 'GOOGLE',
  model: 'gemini-test',
  inputTokens: 100,
  outputTokens: 50,
  inputUsdPerMillion: 0.1,
  outputUsdPerMillion: 0.4,
  audioUsdPerMillion: null,
  imageUsdPerMillion: null,
  usdTwdRate: 32,
  providerCostUsd: 0.00001,
  providerCostTwd: 0.00032,
};

describe('WorklogAiPointLedgerService', () => {
  it('forwards exact entitlement Grant and conservative TWD hold into atomic reservation', async () => {
    const repo = repository();
    vi.mocked(repo.reservePointsAtomic).mockResolvedValue(snapshot('RESERVED', { pointsReserved: 3 }));
    const service = new WorklogAiPointLedgerService(repo, () => 'reservation-1');

    await expect(service.reserveAi({
      chargedUserId: 9,
      actorUserId: 7,
      sourceId: 20,
      requestedPoints: 500,
      entitlementGrantId: 44,
      providerCostHoldTwd: 0.75,
      at: now,
    })).resolves.toMatchObject({
      status: 'RESERVED',
      reservation: { pointsReserved: 3 },
    });
    expect(repo.reservePointsAtomic).toHaveBeenCalledWith(expect.objectContaining({
      chargedUserId: 9,
      actorUserId: 7,
      sourceId: 20,
      requestedPoints: 500,
      entitlementGrantId: 44,
      providerCostHoldTwd: 0.75,
    }));
  });

  it('blocks provider start when no eligible scoped points can be held', async () => {
    const repo = repository();
    vi.mocked(repo.reservePointsAtomic).mockResolvedValue(null);
    const service = new WorklogAiPointLedgerService(repo, () => 'reservation-1');

    await expect(service.reserveAi({
      chargedUserId: 9,
      actorUserId: 7,
      sourceId: 20,
      requestedPoints: 500,
      at: now,
    })).resolves.toEqual({ status: 'AI_POINTS_EXHAUSTED' });
  });

  it('surfaces an atomic monthly provider-cost rejection before provider execution', async () => {
    const repo = repository();
    vi.mocked(repo.reservePointsAtomic).mockRejectedValue(new Error('MONTHLY_PROVIDER_COST_CAP_REACHED'));
    const service = new WorklogAiPointLedgerService(repo, () => 'reservation-1');

    await expect(service.reserveAi({
      chargedUserId: 9,
      actorUserId: 7,
      sourceId: 20,
      requestedPoints: 50,
      entitlementGrantId: 44,
      providerCostHoldTwd: 1.2,
      at: now,
    })).resolves.toEqual({
      status: 'AI_ENTITLEMENT_BLOCKED',
      reason: 'MONTHLY_PROVIDER_COST_CAP_REACHED',
    });
  });

  it('converts immutable provider cost to output-price-equivalent points at commit', async () => {
    const repo = repository();
    const service = new WorklogAiPointLedgerService(repo, () => 'reservation-1');

    await expect(service.commitAiUsage('reservation-1', usage, now)).resolves.toMatchObject({
      status: 'COMMITTED',
      actualPoints: 25,
    });
    expect(repo.commitReservationAtomic).toHaveBeenCalledWith(expect.objectContaining({
      token: 'reservation-1',
      actualPoints: 25,
      usage,
    }));
  });

  it('treats an already committed reservation as idempotent and does not commit twice', async () => {
    const repo = repository();
    vi.mocked(repo.getReservation).mockResolvedValue(snapshot('COMMITTED'));
    const service = new WorklogAiPointLedgerService(repo, () => 'reservation-1');

    await expect(service.commitAiUsage('reservation-1', usage, now)).resolves.toMatchObject({
      status: 'COMMITTED',
      actualPoints: 25,
    });
    expect(repo.commitReservationAtomic).not.toHaveBeenCalled();
  });

  it('releases an active point/provider-cost hold without provider settlement', async () => {
    const repo = repository();
    const service = new WorklogAiPointLedgerService(repo, () => 'reservation-1');

    await expect(service.releaseAi('reservation-1', now)).resolves.toMatchObject({
      status: 'RELEASED',
    });
    expect(repo.releaseReservationAtomic).toHaveBeenCalledWith('reservation-1', now);
  });
});
