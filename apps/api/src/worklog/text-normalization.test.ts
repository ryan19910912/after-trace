import { describe, expect, it, vi } from 'vitest';
import type {
  WorklogAiRuntimeConfigSnapshot,
  WorklogPersistedNormalizationPayload,
  WorklogTextNormalizationProvider,
  WorklogTextNormalizationRepository,
  WorklogTextNormalizationSubscriptionPort,
} from './text-normalization';
import { WorklogTextNormalizationService } from './text-normalization';

const now = new Date('2026-09-02T03:00:00.000Z');
const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE',
  model: 'gemini-test',
  inputUsdPerMillion: 0.1,
  outputUsdPerMillion: 0.4,
  audioUsdPerMillion: null,
  imageUsdPerMillion: null,
  usdTwdRate: 30,
};

function reservation(status: 'RESERVED' | 'COMMITTED' = 'RESERVED') {
  return {
    token: 'reserve-1',
    chargedUserId: 99,
    actorUserId: 7,
    sourceId: 3,
    unitsReserved: 500,
    unitsCommitted: status === 'COMMITTED' ? 15 : 0,
    status,
    periodStart: now,
    periodEnd: null,
    expiresAt: new Date(now.getTime() + 600_000),
  } as const;
}

function baseRepository(): WorklogTextNormalizationRepository {
  return {
    begin: vi.fn().mockResolvedValue({
      status: 'CLAIMED',
      claimToken: 'claim-1',
      context: {
        recordId: 11,
        workspaceId: 2,
        sourceId: 3,
        actorUserId: 7,
        chargedUserId: 99,
        rawText: '王先生案場今天換了兩顆燈泡',
      },
    }),
    getRuntimeConfig: vi.fn().mockResolvedValue(config),
    setPending: vi.fn().mockResolvedValue(undefined),
    saveProviderResult: vi.fn().mockResolvedValue(undefined),
    getReservationStatus: vi.fn().mockResolvedValue('COMMITTED'),
    markUsageCommitted: vi.fn().mockResolvedValue(undefined),
    applyResult: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

function baseSubscriptions(): WorklogTextNormalizationSubscriptionPort {
  return {
    reserveAi: vi.fn().mockResolvedValue({
      status: 'RESERVED',
      reservation: reservation(),
      remainingAiUnits: 1000,
    }),
    commitAiUsage: vi.fn().mockResolvedValue({
      status: 'COMMITTED',
      reservation: reservation('COMMITTED'),
    }),
    releaseAi: vi.fn().mockResolvedValue({
      status: 'RELEASED',
      reservation: { ...reservation(), status: 'RELEASED' as const },
    }),
  };
}

function baseProvider(): WorklogTextNormalizationProvider {
  return {
    reservationUnits: vi.fn().mockReturnValue(500),
    normalize: vi.fn().mockResolvedValue({
      output: {
        summary: '王先生案場今日更換兩顆燈泡。',
        category: 'WORK',
        customerHint: '王先生',
        projectHint: null,
      },
      inputTokens: 10,
      outputTokens: 5,
      providerResponseId: 'response-1',
      latencyMs: 42,
    }),
  };
}

describe('WorklogTextNormalizationService', () => {
  it('reserves owner quota, persists provider output, commits usage, then applies normalized fields', async () => {
    const repository = baseRepository();
    const subscriptions = baseSubscriptions();
    const provider = baseProvider();
    const service = new WorklogTextNormalizationService(
      repository,
      subscriptions,
      provider,
      () => 'claim-1',
    );

    await expect(service.normalizeText(11)).resolves.toEqual({ status: 'NORMALIZED' });
    expect(subscriptions.reserveAi).toHaveBeenCalledWith(expect.objectContaining({
      chargedUserId: 99,
      actorUserId: 7,
      sourceId: 3,
      requestedUnits: 500,
    }));

    expect(repository.saveProviderResult).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(repository.saveProviderResult).mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      recordId: 11,
      claimToken: 'claim-1',
      reservationToken: 'reserve-1',
      usage: {
        actualUnits: 15,
        workspaceId: 2,
        recordId: 11,
        provider: 'GOOGLE',
        model: 'gemini-test',
        inputTokens: 10,
        outputTokens: 5,
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
        audioInputUnits: 0,
        imageInputUnits: 0,
        audioUsdPerMillion: null,
        imageUsdPerMillion: null,
        usdTwdRate: 30,
      },
    });
    expect(persisted?.usage.providerCostUsd).toBeCloseTo(0.000003, 12);
    expect(persisted?.usage.providerCostTwd).toBeCloseTo(0.00009, 12);

    expect(subscriptions.commitAiUsage).toHaveBeenCalledTimes(1);
    expect(repository.markUsageCommitted).toHaveBeenCalledWith(11, 'claim-1');
    expect(repository.applyResult).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 11,
      output: expect.objectContaining({ category: 'WORK' }),
    }));
    expect(subscriptions.releaseAi).not.toHaveBeenCalled();
  });

  it('defers without calling the provider when quota cannot be reserved', async () => {
    const repository = baseRepository();
    const subscriptions = baseSubscriptions();
    const provider = baseProvider();
    vi.mocked(subscriptions.reserveAi).mockResolvedValue({ status: 'AI_QUOTA_EXHAUSTED' });
    const service = new WorklogTextNormalizationService(repository, subscriptions, provider, () => 'claim-1');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'DEFERRED',
      reason: 'AI_QUOTA_EXHAUSTED',
    });
    expect(repository.setPending).toHaveBeenCalledWith(11, 'claim-1', 'AI_QUOTA_EXHAUSTED');
    expect(provider.normalize).not.toHaveBeenCalled();
  });

  it('releases reservation and terminally fails after an uncertain provider attempt', async () => {
    const repository = baseRepository();
    const subscriptions = baseSubscriptions();
    const provider = baseProvider();
    const providerError = Object.assign(new Error('network failed'), { code: 'GEMINI_NETWORK_ERROR' });
    vi.mocked(provider.normalize).mockRejectedValue(providerError);
    const service = new WorklogTextNormalizationService(repository, subscriptions, provider, () => 'claim-1');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'FAILED',
      reason: 'GEMINI_NETWORK_ERROR',
    });
    expect(subscriptions.releaseAi).toHaveBeenCalledWith('reserve-1');
    expect(repository.fail).toHaveBeenCalledWith(
      11,
      'claim-1',
      'GEMINI_NETWORK_ERROR',
      'network failed',
    );
  });

  it('recovers after quota was already committed without calling provider or charging twice', async () => {
    const repository = baseRepository();
    const subscriptions = baseSubscriptions();
    const provider = baseProvider();
    const payload: WorklogPersistedNormalizationPayload = {
      recordId: 11,
      claimToken: 'old-claim',
      reservationToken: 'reserve-1',
      output: {
        summary: '已整理',
        category: 'NOTE',
        customerHint: null,
        projectHint: null,
      },
      usage: {
        actualUnits: 15,
        workspaceId: 2,
        recordId: 11,
        provider: 'GOOGLE',
        model: 'gemini-test',
        inputTokens: 10,
        outputTokens: 5,
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
        providerCostUsd: 0.000003,
      },
    };
    vi.mocked(repository.begin).mockResolvedValue({ status: 'PROVIDER_SUCCEEDED', payload });
    vi.mocked(subscriptions.commitAiUsage).mockResolvedValue({ status: 'RESERVATION_NOT_ACTIVE' });
    vi.mocked(repository.getReservationStatus).mockResolvedValue('COMMITTED');
    const service = new WorklogTextNormalizationService(repository, subscriptions, provider, () => 'new-claim');

    await expect(service.normalizeText(11)).resolves.toEqual({ status: 'NORMALIZED' });
    expect(provider.normalize).not.toHaveBeenCalled();
    expect(subscriptions.reserveAi).not.toHaveBeenCalled();
    expect(subscriptions.commitAiUsage).toHaveBeenCalledTimes(1);
    expect(repository.markUsageCommitted).toHaveBeenCalledWith(11, 'old-claim');
    expect(repository.applyResult).toHaveBeenCalledTimes(1);
  });

  it('does nothing after a completed normalization', async () => {
    const repository = baseRepository();
    const subscriptions = baseSubscriptions();
    const provider = baseProvider();
    vi.mocked(repository.begin).mockResolvedValue({ status: 'SUCCEEDED' });
    const service = new WorklogTextNormalizationService(repository, subscriptions, provider, () => 'claim-2');

    await expect(service.normalizeText(11)).resolves.toEqual({ status: 'ALREADY_NORMALIZED' });
    expect(subscriptions.reserveAi).not.toHaveBeenCalled();
    expect(provider.normalize).not.toHaveBeenCalled();
  });
});
