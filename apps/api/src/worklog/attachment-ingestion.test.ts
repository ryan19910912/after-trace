import { describe, expect, it } from 'vitest';
import type { LineMessageContent } from '../line/content';
import {
  WorklogAttachmentIngestionService,
  type WorklogAttachmentClaimState,
  type WorklogAttachmentOutput,
  type WorklogAttachmentProviderResponse,
  type WorklogAttachmentRepository,
} from './attachment-ingestion';
import type { WorklogAiReservationSnapshot, WorklogAiUsageCommit } from './subscription';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

const config: WorklogAiRuntimeConfigSnapshot = {
  provider: 'GOOGLE', model: 'gemini-test', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4,
  audioUsdPerMillion: null, imageUsdPerMillion: null, usdTwdRate: 32,
};
const content: LineMessageContent = { lineMessageId: 'quoted-1', mimeType: 'image/jpeg', byteLength: 100, dataBase64: 'AA==' };
const output: WorklogAttachmentOutput = { inputType: 'IMAGE', rawText: '配電箱照片', summary: '配電箱現況', category: 'WORK', attachmentMetadata: { mimeType: 'image/jpeg' } };

class Repo implements WorklogAttachmentRepository {
  state: WorklogAttachmentClaimState = { status: 'CLAIMED' };
  saved: { recordId: number; reservationToken: string; usage: WorklogAiUsageCommit } | null = null;
  failed: string | null = null;
  persistFailures = 0;
  persistCalls = 0;

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
    const usage = { ...input.usage, recordId: 33 };
    this.saved = { recordId: 33, reservationToken: input.reservationToken, usage };
    this.state = { status: 'RECORD_CREATED', recordId: 33, reservationToken: input.reservationToken, usage };
    return { status: 'CREATED' as const, recordId: 33 };
  }
  reservationStatus() { return Promise.resolve<'COMMITTED'>('COMMITTED'); }
  async markSucceeded(_command: string, recordId: number) { this.state = { status: 'SUCCEEDED', recordId }; }
  async fail(_command: string, reason: string) { this.failed = reason; this.state = { status: 'FAILED', reason }; }
}

class Subscription {
  reserveCalls = 0;
  commitCalls = 0;
  releaseCalls = 0;
  async reserveAi(input: { chargedUserId: number; actorUserId: number; sourceId?: number | null; requestedUnits: number }) {
    this.reserveCalls += 1;
    const reservation: WorklogAiReservationSnapshot = {
      token: 'reservation-1', chargedUserId: input.chargedUserId, actorUserId: input.actorUserId,
      sourceId: input.sourceId ?? null, unitsReserved: input.requestedUnits, unitsCommitted: 0,
      status: 'RESERVED', periodStart: new Date('2026-09-01T00:00:00Z'), periodEnd: null,
      expiresAt: new Date('2026-09-02T01:00:00Z'),
    };
    return { status: 'RESERVED' as const, reservation, remainingAiUnits: 1000 };
  }
  async commitAiUsage() { this.commitCalls += 1; return { status: 'COMMITTED' as const, reservation: {} as WorklogAiReservationSnapshot }; }
  async releaseAi() { this.releaseCalls += 1; return { status: 'RELEASED' as const, reservation: {} as WorklogAiReservationSnapshot }; }
}

class ContentResolver {
  calls = 0;
  async content() { this.calls += 1; return content; }
}

class Provider {
  calls = 0;
  reservationUnits() { return 500; }
  async analyze(): Promise<WorklogAttachmentProviderResponse> {
    this.calls += 1;
    return { output, inputTokens: 100, outputTokens: 50, audioInputUnits: 0, imageInputUnits: 100, providerResponseId: 'r1', latencyMs: 10 };
  }
}

const input = {
  sourceId: 20, actorUserId: 7, chargedUserId: 9,
  commandLineMessageId: 'command-1', quotedLineMessageId: 'quoted-1',
  sourceTimestamp: new Date('2026-09-02T00:00:00Z'),
};

describe('WorklogAttachmentIngestionService', () => {
  it('fetches, reserves, analyzes, atomically stores state and commits a quoted attachment once', async () => {
    const repo = new Repo(); const subscription = new Subscription(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, subscription, resolver, provider);
    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(resolver.calls).toBe(1); expect(provider.calls).toBe(1); expect(subscription.reserveCalls).toBe(1); expect(subscription.commitCalls).toBe(1);
    expect(repo.saved?.usage.recordId).toBe(33);
  });

  it('returns a completed duplicate without refetching LINE or calling AI', async () => {
    const repo = new Repo(); repo.state = { status: 'SUCCEEDED', recordId: 33 };
    const subscription = new Subscription(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, subscription, resolver, provider);
    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: true });
    expect(resolver.calls).toBe(0); expect(provider.calls).toBe(0); expect(subscription.reserveCalls).toBe(0);
  });

  it('resumes quota settlement from RECORD_CREATED without a second provider call', async () => {
    const repo = new Repo();
    repo.state = { status: 'RECORD_CREATED', recordId: 33, reservationToken: 'reservation-1', usage: {
      actualUnits: 150, recordId: 33, provider: 'GOOGLE', model: 'gemini-test', inputTokens: 100, outputTokens: 50,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4, providerCostUsd: 0.00003,
    } };
    const subscription = new Subscription(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, subscription, resolver, provider);
    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(resolver.calls).toBe(0); expect(provider.calls).toBe(0); expect(subscription.reserveCalls).toBe(0); expect(subscription.commitCalls).toBe(1);
  });

  it('retries only atomic persistence after a transient DB uncertainty without calling Gemini twice', async () => {
    const repo = new Repo(); repo.persistFailures = 1;
    const subscription = new Subscription(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, subscription, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'RECORDED', recordId: 33, duplicate: false });
    expect(repo.persistCalls).toBe(2);
    expect(provider.calls).toBe(1);
    expect(subscription.reserveCalls).toBe(1);
    expect(subscription.releaseCalls).toBe(0);
    expect(subscription.commitCalls).toBe(1);
  });

  it('leaves an unresolved post-provider persistence failure in progress instead of releasing quota or overwriting durable state', async () => {
    const repo = new Repo(); repo.persistFailures = 2;
    const subscription = new Subscription(); const resolver = new ContentResolver(); const provider = new Provider();
    const service = new WorklogAttachmentIngestionService(repo, subscription, resolver, provider);

    await expect(service.ingest(input)).resolves.toEqual({ status: 'IN_PROGRESS' });
    expect(repo.persistCalls).toBe(2);
    expect(provider.calls).toBe(1);
    expect(subscription.releaseCalls).toBe(0);
    expect(repo.failed).toBeNull();
  });
});
