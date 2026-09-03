import { describe, expect, it, vi } from 'vitest';
import type {
  WorklogAiRuntimeConfigSnapshot,
  WorklogPersistedNormalizationPayload,
  WorklogTextNormalizationAiPointPort,
  WorklogTextNormalizationProvider,
  WorklogTextNormalizationRepository,
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

function reservation(status: 'RESERVED' | 'COMMITTED' | 'RELEASED' = 'RESERVED') {
  return {
    id: 1,
    token: 'reserve-1',
    chargedUserId: 99,
    actorUserId: 7,
    sourceId: 3,
    pointsReserved: 500,
    pointsCommitted: status === 'COMMITTED' ? 8 : 0,
    platformSubsidizedPoints: 0,
    status,
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
        rawText: '王先生今天在晴空案換了兩顆燈泡',
        occurredAt: now,
      },
    }),
    getRuntimeConfig: vi.fn().mockResolvedValue(config),
    setPending: vi.fn().mockResolvedValue(undefined),
    saveProviderResult: vi.fn().mockResolvedValue(undefined),
    getReservationStatus: vi.fn().mockResolvedValue('COMMITTED'),
    markUsageCommitted: vi.fn().mockResolvedValue(undefined),
    applyResult: vi.fn().mockResolvedValue({ status: 'APPLIED', entityId: 71, createdEntity: true }),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

function baseAiPoints(): WorklogTextNormalizationAiPointPort {
  return {
    reserveAi: vi.fn().mockResolvedValue({
      status: 'RESERVED',
      reservation: reservation(),
      remainingAiPoints: 1000,
    }),
    commitAiUsage: vi.fn().mockResolvedValue({
      status: 'COMMITTED',
      reservation: reservation('COMMITTED'),
      actualPoints: 8,
    }),
    releaseAi: vi.fn().mockResolvedValue({
      status: 'RELEASED',
      reservation: reservation('RELEASED'),
    }),
  };
}

function baseProvider(): WorklogTextNormalizationProvider {
  return {
    reservationUnits: vi.fn().mockReturnValue(500),
    normalize: vi.fn().mockResolvedValue({
      output: {
        title: '晴空案',
        titleRequiresConfirmation: false,
        occurredAt: '2026-09-02T03:00:00.000Z',
      },
      inputTokens: 10,
      outputTokens: 5,
      providerResponseId: 'response-1',
      latencyMs: 42,
    }),
  };
}

describe('WorklogTextNormalizationService', () => {
  it('holds points, persists provider output, commits actual point usage, then applies one title/time interpretation', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    const service = new WorklogTextNormalizationService(
      repository,
      aiPoints,
      provider,
      () => 'claim-1',
    );

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'NORMALIZED',
      entityId: 71,
      createdEntity: true,
    });
    expect(provider.reservationUnits).toHaveBeenCalledWith(
      {
        text: '王先生今天在晴空案換了兩顆燈泡',
        referenceOccurredAt: now.toISOString(),
      },
      config,
    );
    expect(aiPoints.reserveAi).toHaveBeenCalledWith(expect.objectContaining({
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
      output: {
        title: '晴空案',
        titleRequiresConfirmation: false,
      },
      usage: {
        actualUnits: 8,
        workspaceId: 2,
        recordId: 11,
        operation: 'TEXT_RECORD_CREATE',
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

    expect(aiPoints.commitAiUsage).toHaveBeenCalledTimes(1);
    expect(repository.markUsageCommitted).toHaveBeenCalledWith(11, 'claim-1');
    expect(repository.applyResult).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 11,
      output: expect.objectContaining({ title: '晴空案' }),
    }));
    expect(aiPoints.releaseAi).not.toHaveBeenCalled();
  });

  it('persists full provider cost and point usage even when actual cost exceeds the preflight estimate', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    vi.mocked(provider.normalize).mockResolvedValue({
      output: {
        title: '晴空案',
        titleRequiresConfirmation: false,
        occurredAt: null,
      },
      inputTokens: 450,
      outputTokens: 100,
      providerResponseId: 'response-overage',
      latencyMs: 50,
    });
    const service = new WorklogTextNormalizationService(repository, aiPoints, provider, () => 'claim-1');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'NORMALIZED', entityId: 71, createdEntity: true,
    });
    expect(repository.saveProviderResult).toHaveBeenCalledWith(expect.objectContaining({
      usage: expect.objectContaining({ actualUnits: 213 }),
    }));
    expect(aiPoints.commitAiUsage).toHaveBeenCalledWith(
      'reserve-1',
      expect.objectContaining({ actualUnits: 213 }),
    );
    expect(aiPoints.releaseAi).not.toHaveBeenCalled();
  });

  it('defers without calling the provider when scoped AI points cannot be reserved', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    vi.mocked(aiPoints.reserveAi).mockResolvedValue({ status: 'AI_POINTS_EXHAUSTED' });
    const service = new WorklogTextNormalizationService(repository, aiPoints, provider, () => 'claim-1');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'DEFERRED',
      reason: 'AI_POINTS_EXHAUSTED',
    });
    expect(repository.setPending).toHaveBeenCalledWith(11, 'claim-1', 'AI_POINTS_EXHAUSTED');
    expect(provider.normalize).not.toHaveBeenCalled();
  });

  it('releases reservation and terminally fails when no usable provider response exists', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    const providerError = Object.assign(new Error('network failed'), { code: 'GEMINI_NETWORK_ERROR' });
    vi.mocked(provider.normalize).mockRejectedValue(providerError);
    const service = new WorklogTextNormalizationService(repository, aiPoints, provider, () => 'claim-1');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'FAILED',
      reason: 'GEMINI_NETWORK_ERROR',
    });
    expect(aiPoints.releaseAi).toHaveBeenCalledWith('reserve-1');
    expect(repository.fail).toHaveBeenCalledWith(
      11,
      'claim-1',
      'GEMINI_NETWORK_ERROR',
      'network failed',
    );
  });

  it('maps a durable ambiguous-title apply result to pending confirmation without another provider call', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    vi.mocked(repository.applyResult).mockResolvedValue({
      status: 'PENDING_CONFIRMATION',
      confirmationId: 88,
    });
    const payload: WorklogPersistedNormalizationPayload = {
      recordId: 11,
      claimToken: 'old-claim',
      reservationToken: 'reserve-1',
      output: {
        title: '三重晴空',
        titleRequiresConfirmation: true,
        occurredAt: null,
      },
      usage: {
        actualUnits: 8,
        workspaceId: 2,
        recordId: 11,
        operation: 'TEXT_RECORD_CREATE',
        provider: 'GOOGLE',
        model: 'gemini-test',
        inputTokens: 10,
        outputTokens: 5,
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.4,
        providerCostUsd: 0.000003,
      },
    };
    vi.mocked(repository.begin).mockResolvedValue({ status: 'USAGE_COMMITTED', payload });
    const service = new WorklogTextNormalizationService(repository, aiPoints, provider, () => 'new-claim');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'PENDING_CONFIRMATION', confirmationId: 88,
    });
    expect(provider.normalize).not.toHaveBeenCalled();
    expect(aiPoints.reserveAi).not.toHaveBeenCalled();
    expect(repository.applyResult).toHaveBeenCalledTimes(1);
  });

  it('recovers after points were already committed without calling provider or charging twice', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    const payload: WorklogPersistedNormalizationPayload = {
      recordId: 11,
      claimToken: 'old-claim',
      reservationToken: 'reserve-1',
      output: {
        title: '晴空案',
        titleRequiresConfirmation: false,
        occurredAt: null,
      },
      usage: {
        actualUnits: 8,
        workspaceId: 2,
        recordId: 11,
        operation: 'TEXT_RECORD_CREATE',
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
    vi.mocked(aiPoints.commitAiUsage).mockResolvedValue({ status: 'RESERVATION_NOT_ACTIVE' });
    vi.mocked(repository.getReservationStatus).mockResolvedValue('COMMITTED');
    const service = new WorklogTextNormalizationService(repository, aiPoints, provider, () => 'new-claim');

    await expect(service.normalizeText(11)).resolves.toEqual({
      status: 'NORMALIZED', entityId: 71, createdEntity: true,
    });
    expect(provider.normalize).not.toHaveBeenCalled();
    expect(aiPoints.reserveAi).not.toHaveBeenCalled();
    expect(aiPoints.commitAiUsage).toHaveBeenCalledTimes(1);
    expect(repository.markUsageCommitted).toHaveBeenCalledWith(11, 'old-claim');
    expect(repository.applyResult).toHaveBeenCalledTimes(1);
  });

  it('does nothing after a completed interpretation', async () => {
    const repository = baseRepository();
    const aiPoints = baseAiPoints();
    const provider = baseProvider();
    vi.mocked(repository.begin).mockResolvedValue({ status: 'SUCCEEDED' });
    const service = new WorklogTextNormalizationService(repository, aiPoints, provider, () => 'claim-2');

    await expect(service.normalizeText(11)).resolves.toEqual({ status: 'ALREADY_NORMALIZED' });
    expect(aiPoints.reserveAi).not.toHaveBeenCalled();
    expect(provider.normalize).not.toHaveBeenCalled();
  });
});