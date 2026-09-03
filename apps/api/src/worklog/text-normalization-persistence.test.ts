import { describe, expect, it, vi } from 'vitest';
import {
  WorklogTextNormalizationService,
  type WorklogAiRuntimeConfigSnapshot,
  type WorklogTextNormalizationContext,
  type WorklogTextNormalizationRepository,
  type WorklogTextNormalizationSubscriptionPort,
} from './text-normalization';

const referenceOccurredAt = new Date('2026-09-02T03:00:00Z');
const context: WorklogTextNormalizationContext = {
  recordId: 10,
  workspaceId: 20,
  sourceId: 30,
  actorUserId: 40,
  chargedUserId: 50,
  rawText: '今天完成浴室配線',
  occurredAt: referenceOccurredAt,
};

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE',
  model: 'gemini-test',
  inputUsdPerMillion: 0.1,
  outputUsdPerMillion: 0.2,
  audioUsdPerMillion: null,
  imageUsdPerMillion: null,
  usdTwdRate: 32,
};

function repository(saveProviderResult: WorklogTextNormalizationRepository['saveProviderResult']): WorklogTextNormalizationRepository {
  return {
    begin: vi.fn(async () => ({ status: 'CLAIMED' as const, context, claimToken: 'claim-1' })),
    getRuntimeConfig: vi.fn(async () => config),
    setPending: vi.fn(async () => undefined),
    saveProviderResult,
    getReservationStatus: vi.fn(async () => 'RESERVED' as const),
    markUsageCommitted: vi.fn(async () => undefined),
    applyResult: vi.fn(async () => ({ status: 'APPLIED' as const, entityId: 77, createdEntity: true })),
    fail: vi.fn(async () => undefined),
  };
}

function subscriptions() {
  const releaseAi = vi.fn(async () => ({
    status: 'RELEASED' as const,
    reservation: {
      token: 'reservation-1', chargedUserId: 50, actorUserId: 40, sourceId: 30,
      unitsReserved: 100, unitsCommitted: 0, status: 'RELEASED' as const,
      periodStart: new Date('2026-09-01T00:00:00Z'), periodEnd: null,
      expiresAt: new Date('2026-09-02T00:10:00Z'),
    },
  }));
  const port: WorklogTextNormalizationSubscriptionPort = {
    reserveAi: vi.fn(async () => ({
      status: 'RESERVED' as const,
      remainingAiUnits: 900,
      reservation: {
        token: 'reservation-1', chargedUserId: 50, actorUserId: 40, sourceId: 30,
        unitsReserved: 100, unitsCommitted: 0, status: 'RESERVED' as const,
        periodStart: new Date('2026-09-01T00:00:00Z'), periodEnd: null,
        expiresAt: new Date('2026-09-02T00:10:00Z'),
      },
    })),
    commitAiUsage: vi.fn(async () => ({ status: 'RESERVATION_NOT_ACTIVE' as const })),
    releaseAi,
  };
  return { port, releaseAi };
}

describe('WorklogTextNormalizationService persistence uncertainty', () => {
  it('keeps the reservation and returns IN_PROGRESS when provider succeeded but provider-result persistence failed', async () => {
    const saveProviderResult = vi.fn(async () => { throw new Error('database unavailable'); });
    const repo = repository(saveProviderResult);
    const { port, releaseAi } = subscriptions();
    const normalize = vi.fn(async () => ({
      output: {
        title: '浴室配線',
        titleRequiresConfirmation: false,
        occurredAt: referenceOccurredAt.toISOString(),
      },
      inputTokens: 20,
      outputTokens: 10,
      providerResponseId: 'provider-1',
      latencyMs: 120,
    }));
    const service = new WorklogTextNormalizationService(repo, port, {
      reservationUnits: () => 100,
      normalize,
    }, () => 'claim-1');

    await expect(service.normalizeText(10)).resolves.toEqual({ status: 'IN_PROGRESS' });
    expect(normalize).toHaveBeenCalledWith({
      text: context.rawText,
      referenceOccurredAt: referenceOccurredAt.toISOString(),
    }, config);
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(saveProviderResult).toHaveBeenCalledTimes(1);
    expect(releaseAi).not.toHaveBeenCalled();
    expect(repo.fail).not.toHaveBeenCalled();
  });

  it('still releases the reservation for a provider call that throws without returning a response', async () => {
    const repo = repository(vi.fn(async () => undefined));
    const { port, releaseAi } = subscriptions();
    const service = new WorklogTextNormalizationService(repo, port, {
      reservationUnits: () => 100,
      normalize: vi.fn(async () => { throw new Error('provider failed'); }),
    }, () => 'claim-1');

    await expect(service.normalizeText(10)).resolves.toEqual({ status: 'FAILED', reason: 'AI_NORMALIZATION_FAILED' });
    expect(releaseAi).toHaveBeenCalledTimes(1);
    expect(repo.fail).toHaveBeenCalledTimes(1);
  });
});
