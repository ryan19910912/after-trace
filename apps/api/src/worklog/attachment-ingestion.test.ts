import { describe, expect, it } from 'vitest';
import type { LineMessageContent } from '../line/content';
import {
  WorklogAttachmentIngestionService,
  type WorklogAttachmentClaimState,
  type WorklogAttachmentOutput,
  type WorklogAttachmentProviderResponse,
  type WorklogAttachmentRepository,
} from './attachment-ingestion';
import type { WorklogAiPointReservationSnapshot } from './ai-point-ledger';
import { providerCostToAiPoints } from './ai-points';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};
const content: LineMessageContent = { lineMessageId: 'quoted-1', mimeType: 'image/jpeg', byteLength: 100, dataBase64: 'AA==' };
const output: WorklogAttachmentOutput = {
  inputType: 'IMAGE',
  rawText: '配電箱照片',
  attachmentMetadata: { mimeType: 'image/jpeg' },
};

class Repo implements WorklogAttachmentRepository {
  state: WorklogAttachmentClaimState = { status: 'CLAIMED' };
  saved: { recordId: number; reservationToken: string; usage: WorklogAiUsageCommit } | null = null;
  failed: string | null = null;
  persistFailures = 0;
  persistCalls = 0;
  sourceMissing = false;

  claim() {
    const current = this.state;
    if (current.status === 'CLAIMED') this.state = { status: 'PROCESSING' };
    return Promise.resolve(current);
  }
  getRuntimeConfig() { return Promise.resolve(config); }
  async persistRecordCreated(input: { reservationToken: string; usage: WorklogAiUsageCommit }) {
    this.persistCalls += 1;
    if (this.persistFailures > 0) {
      this.persistFailures -= 1;
      throw new Error('database write uncertain');
    }
    if (this.sourceMissing) {
      this.state = {
        status: 'PROVIDER_SUCCEEDED',
        reservationToken: input.reservationToken,
        usage: input.usage,
        failureReason: 'SOURCE_NOT_FOUND',
      };
      return { status: 'SOURCE_NOT_FOUND' as const };
    }
    const usage = { ...input.usage, recordId: 33 };
    this.saved = { recordId: 33, reservationToken: input.reservationToken, usage };
    this.state = { status: 'RECORD_CREATED', recordId: 33, reservationToken: input.reservationToken, usage };
    return { status: 'CREATED' as const, recordId: 33 };
  }
  reservationStatus() { return Promise.resolve<'COMMITTED'>('COMMITTED'); }
  async markSucceeded(_command: string, recordId: number) { this.state = { status: 'SUCCEEDED', recordId }; }
  async fail(_command: string, reason: string) { this.failed = reason; this.state = { status: 'FAILED', reason }; }
}

class AiPoints {
  reserveCalls = 0;
  commitCalls = 0;
  releaseCalls = 0;
  committedPoints: number[] = [];
  async reserveAi(input: { chargedUserId: number; actorUserId: number; sourceId?: number | null; requestedPoints: number }) {
    this.reserveCalls += 1;
    const reservation: WorklogAiPointReservationSnapshot = {
      id: 1,
      token: 'reservation-1',
      chargedUserId: input.chargedUserId,
      actorUserId: input.actorUserId,
      sourceId: input.sourceId ?? 20,
      pointsReserved: input.requestedPoints,
      pointsCommitted: 0,
      platformSubsidizedPoints: 0,
      status: 'RESERVED',
      expiresAt: new Date('2026-09-02T01:00:00Z'),
    };
    return { status: 'RESERVED' as const, reservation, remainingAiPoints: 1000 };
  }
  async commitAiUsage(_token?: string, usage?: WorklogAiUsageCommit) {
    this.commitCalls += 1;
    const actualPoints = usage ? providerCostToAiPoints({
      providerCostUsd: usage.providerCostUsd,
      outputUsdPerMillion: usage.outputUsdPerMillion,
    }) : 0;
    if (usage) this.committedPoints.push(actualPoints);
    const reservation: WorklogAiPointReservationSnapshot = {
      id: 1, token: 'reservation-1', chargedUserId: 9, actorUserId: 7, sourceId: 20,
      pointsReserved: 500, pointsCommitted: actualPoints, platformSubsidizedPoints: 0,
      status: 'COMMITTED', expiresAt: new Date('2026-09-02T01:00:00Z'),
    };
    return { status: 'COMMITTED' as const, reservation, actualPoints };
  }
  async releaseAi() {
    this.releaseCalls += 1;
    const reservation: WorklogAiPointReservationSnapshot = {
      id: 1, token: 'reservation-1', chargedUserId: 9, actorUserId: 7, sourceId: 20,
      pointsReserved: 500, pointsCommitted: 0, platformSubsidizedPoints: 0,
      status: 'RELEASED', expiresAt: new Date('2026-09-02T01:00:00Z'),
    };
    return { status: 'RELEASED' as const, reservation };
  }
}

class ContentResolver {
  calls = 0;
  async content() { this.calls += 1; return content; }
}

class NonRetrievableContentResolver {
  calls = 0;
  async content(): Promise<LineMessageContent> {
    this.calls += 1;
    const error = new Error('LINE_CONTENT_NOT_RETRIEVABLE') as Error & { code: string };
    error.code = 'LINE_CONTENT_NOT_RETRIEVABLE';
    throw error;
  }
}

class Provider {
  calls = 0;
  reservationUnits() { return 500; }
  async analyze(): Promise<WorklogAttachmentProviderResponse> {
    this.calls += 1;
    return { output, inputTokens: 100, outputTokens: 50, audioInputUnits: 0, imageInputUnits: 100, providerResponseId: 'r1', latencyMs: 10 };
  }
}

class OverageProvider extends Provider {
  override async analyze(): Promise<WorklogAttachmentProviderResponse> {
    this.calls += 1;
    return { output, inputTokens: 450, outputTokens: 100, audioInputUnits: 0, imageInputUnits: 400, providerResponseId: 'r2', latencyMs: 10 };
  }
}

const input = {
  sourceId: 20, actorUserId: 7, chargedUserId: 9,
  commandLineMessageId: 'command-1', quotedLineMessageId: 'quoted-1',
  sourceTimestamp: new Date('2026-09-02T00:00:00Z'),
};

const durableUsage: WorklogAiUsageCommit = {
  provider: 'GOOGLE', model: 'gemini-test', inputTokens: 100, outputTokens: 50,
  inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4, providerCostUsd: 0.00003,
};

describe('WorklogAttachmentIngestionService', () => {
  it('fetches, holds points, analyzes, atomically stores state and commits a quoted attachment once', async () => {
    const repo = new Repo(); const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);
    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(resolver.calls).toBe(1); expect(provider.calls).toBe(1); expect(aiPoints.reserveCalls).toBe(1); expect(aiPoints.commitCalls).toBe(1);
    expect(repo.saved?.usage.recordId).toBe(33);
    expect(repo.saved?.usage.operation).toBe('IMAGE_RECORD_CREATE');
    expect(repo.saved?.usage).not.toHaveProperty('actualUnits');
    expect(aiPoints.committedPoints).toEqual([75]);
  });

  it('commits full actual provider point cost when attachment usage exceeds the conservative reservation', async () => {
    const repo = new Repo(); const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new OverageProvider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(aiPoints.releaseCalls).toBe(0);
    expect(aiPoints.committedPoints).toEqual([213]);
  });

  it('settles provider cost and never releases points if the source disappears after Gemini succeeds', async () => {
    const repo = new Repo(); repo.sourceMissing = true;
    const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'FAILED', reason: 'SOURCE_NOT_FOUND' });
    expect(provider.calls).toBe(1);
    expect(aiPoints.commitCalls).toBe(1);
    expect(aiPoints.releaseCalls).toBe(0);
    expect(repo.failed).toBe('SOURCE_NOT_FOUND');
  });

  it('resumes a durable provider-success failure without refetching LINE or calling Gemini again', async () => {
    const repo = new Repo();
    repo.state = {
      status: 'PROVIDER_SUCCEEDED',
      reservationToken: 'reservation-1',
      usage: durableUsage,
      failureReason: 'SOURCE_NOT_FOUND',
    };
    const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'FAILED', reason: 'SOURCE_NOT_FOUND' });
    expect(resolver.calls).toBe(0);
    expect(provider.calls).toBe(0);
    expect(aiPoints.reserveCalls).toBe(0);
    expect(aiPoints.commitCalls).toBe(1);
  });

  it('classifies LINE content but blocks media before point/provider work when AI media capability is disabled', async () => {
    const repo = new Repo(); const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest({ ...input, allowAiMedia: false })).resolves.toEqual({
      status: 'FAILED',
      reason: 'AI_MEDIA_DISABLED',
    });
    expect(resolver.calls).toBe(1);
    expect(aiPoints.reserveCalls).toBe(0);
    expect(provider.calls).toBe(0);
    expect(repo.failed).toBe('AI_MEDIA_DISABLED');
  });

  it('preserves quoted-TEXT re-entry classification when media AI is disabled', async () => {
    const repo = new Repo(); const aiPoints = new AiPoints(); const resolver = new NonRetrievableContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest({ ...input, allowAiMedia: false })).resolves.toEqual({
      status: 'FAILED',
      reason: 'LINE_CONTENT_NOT_RETRIEVABLE',
    });
    expect(resolver.calls).toBe(1);
    expect(aiPoints.reserveCalls).toBe(0);
    expect(provider.calls).toBe(0);
    expect(repo.failed).toBe('LINE_CONTENT_NOT_RETRIEVABLE');
  });

  it('returns a completed duplicate without refetching LINE or calling AI', async () => {
    const repo = new Repo(); repo.state = { status: 'SUCCEEDED', recordId: 33 };
    const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);
    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: true });
    expect(resolver.calls).toBe(0); expect(provider.calls).toBe(0); expect(aiPoints.reserveCalls).toBe(0);
  });

  it('resumes point settlement from RECORD_CREATED without a second provider call', async () => {
    const repo = new Repo();
    repo.state = { status: 'RECORD_CREATED', recordId: 33, reservationToken: 'reservation-1', usage: {
      ...durableUsage,
      recordId: 33,
    } };
    const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);
    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(resolver.calls).toBe(0); expect(provider.calls).toBe(0); expect(aiPoints.reserveCalls).toBe(0); expect(aiPoints.commitCalls).toBe(1);
  });

  it('retries only atomic persistence after a transient DB uncertainty without calling Gemini twice', async () => {
    const repo = new Repo(); repo.persistFailures = 1;
    const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(repo.persistCalls).toBe(2);
    expect(provider.calls).toBe(1);
    expect(aiPoints.reserveCalls).toBe(1);
    expect(aiPoints.releaseCalls).toBe(0);
    expect(aiPoints.commitCalls).toBe(1);
  });

  it('leaves an unresolved post-provider persistence failure in progress instead of releasing points or overwriting durable state', async () => {
    const repo = new Repo(); repo.persistFailures = 2;
    const aiPoints = new AiPoints(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, aiPoints, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'IN_PROGRESS' });
    expect(repo.persistCalls).toBe(2);
    expect(provider.calls).toBe(1);
    expect(aiPoints.releaseCalls).toBe(0);
    expect(repo.failed).toBeNull();
  });
});
