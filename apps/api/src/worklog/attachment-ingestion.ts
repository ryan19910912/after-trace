import type { LineMessageContent } from '../line/content';
import type {
  AiCommitResult,
  AiReleaseResult,
  AiReservationResult,
  WorklogAiUsageCommit,
} from './subscription';
import type { WorklogAiRuntimeConfigSnapshot, WorklogTextCategory } from './text-normalization';

export type WorklogAttachmentInputType = 'AUDIO' | 'IMAGE' | 'FILE';

export type WorklogAttachmentOutput = {
  inputType: WorklogAttachmentInputType;
  rawText: string;
  summary: string;
  category: WorklogTextCategory;
  attachmentMetadata: Record<string, unknown>;
};

export type WorklogAttachmentProviderResponse = {
  output: WorklogAttachmentOutput;
  inputTokens: number;
  outputTokens: number;
  audioInputUnits: number;
  imageInputUnits: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export type WorklogAttachmentClaimState =
  | { status: 'CLAIMED' }
  | { status: 'PROCESSING' }
  | { status: 'RECORD_CREATED'; recordId: number; reservationToken: string; usage: WorklogAiUsageCommit }
  | { status: 'SUCCEEDED'; recordId: number }
  | { status: 'FAILED'; reason: string };

export interface WorklogAttachmentRepository {
  claim(input: {
    sourceId: number;
    actorUserId: number;
    commandLineMessageId: string;
    quotedLineMessageId: string;
  }): Promise<WorklogAttachmentClaimState>;
  getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
  persistRecordCreated(input: {
    sourceId: number;
    actorUserId: number;
    commandLineMessageId: string;
    quotedLineMessageId: string;
    sourceTimestamp: Date;
    output: WorklogAttachmentOutput;
    reservationToken: string;
    usage: WorklogAiUsageCommit;
  }): Promise<{ status: 'CREATED' | 'EXISTING'; recordId: number } | { status: 'SOURCE_NOT_FOUND' }>;
  reservationStatus(token: string): Promise<'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null>;
  markSucceeded(commandLineMessageId: string, recordId: number): Promise<void>;
  fail(commandLineMessageId: string, reason: string): Promise<void>;
}

export interface WorklogAttachmentContentPort {
  content(lineMessageId: string, maxBytes?: number): Promise<LineMessageContent>;
}

export interface WorklogAttachmentProvider {
  reservationUnits(content: LineMessageContent, config: WorklogAiRuntimeConfigSnapshot): number;
  analyze(
    content: LineMessageContent,
    config: WorklogAiRuntimeConfigSnapshot,
    instruction?: string | null,
  ): Promise<WorklogAttachmentProviderResponse>;
}

export interface WorklogAttachmentSubscriptionPort {
  reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedUnits: number;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiReservationResult>;
  commitAiUsage(token: string, usage: WorklogAiUsageCommit, at?: Date): Promise<AiCommitResult>;
  releaseAi(token: string, at?: Date): Promise<AiReleaseResult>;
}

export type WorklogAttachmentIngestionResult =
  | { status: 'RECORDED'; recordId: number; duplicate: boolean }
  | { status: 'IN_PROGRESS' }
  | { status: 'FAILED'; reason: string };

export class WorklogAttachmentIngestionService {
  constructor(
    private readonly repository: WorklogAttachmentRepository,
    private readonly subscriptions: WorklogAttachmentSubscriptionPort,
    private readonly contentResolver: WorklogAttachmentContentPort,
    private readonly provider: WorklogAttachmentProvider,
  ) {}

  async ingest(input: {
    sourceId: number;
    actorUserId: number;
    chargedUserId: number;
    commandLineMessageId: string;
    quotedLineMessageId: string;
    sourceTimestamp: Date;
    instruction?: string | null;
    allowAiMedia?: boolean;
  }): Promise<WorklogAttachmentIngestionResult> {
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const actorUserId = positiveInteger(input.actorUserId, 'actorUserId');
    const chargedUserId = positiveInteger(input.chargedUserId, 'chargedUserId');
    const commandLineMessageId = requiredText(input.commandLineMessageId, 'commandLineMessageId', 64);
    const quotedLineMessageId = requiredText(input.quotedLineMessageId, 'quotedLineMessageId', 64);

    const claimInput = { sourceId, actorUserId, commandLineMessageId, quotedLineMessageId };
    const claimed = await this.repository.claim(claimInput);
    if (claimed.status === 'SUCCEEDED') {
      return { status: 'RECORDED', recordId: claimed.recordId, duplicate: true };
    }
    if (claimed.status === 'PROCESSING') return { status: 'IN_PROGRESS' };
    if (claimed.status === 'FAILED') return { status: 'FAILED', reason: claimed.reason };
    if (claimed.status === 'RECORD_CREATED') return this.settleExisting(commandLineMessageId, claimed);

    let reservationToken: string | null = null;
    let providerCompleted = false;
    try {
      // Resolve only enough LINE content to distinguish a retrievable attachment from
      // an old quoted TEXT. The latter returns LINE_CONTENT_NOT_RETRIEVABLE and must
      // keep the explicit re-entry guidance even when AI media capability is disabled.
      const content = await this.contentResolver.content(quotedLineMessageId);
      if (input.allowAiMedia === false) {
        await this.repository.fail(commandLineMessageId, 'AI_MEDIA_DISABLED');
        return { status: 'FAILED', reason: 'AI_MEDIA_DISABLED' };
      }

      const config = await this.repository.getRuntimeConfig();
      if (!config) {
        await this.repository.fail(commandLineMessageId, 'AI_RUNTIME_CONFIG_MISSING');
        return { status: 'FAILED', reason: 'AI_RUNTIME_CONFIG_MISSING' };
      }

      const requestedUnits = positiveInteger(this.provider.reservationUnits(content, config), 'requestedUnits');
      const reservation = await this.subscriptions.reserveAi({
        chargedUserId,
        actorUserId,
        sourceId,
        requestedUnits,
        ttlMs: 10 * 60_000,
      });
      if (reservation.status !== 'RESERVED') {
        await this.repository.fail(commandLineMessageId, reservation.status);
        return { status: 'FAILED', reason: reservation.status };
      }
      reservationToken = reservation.reservation.token;

      const provider = await this.provider.analyze(content, config, input.instruction ?? null);
      providerCompleted = true;
      const actualUnits = provider.inputTokens + provider.outputTokens;
      if (!Number.isSafeInteger(actualUnits) || actualUnits < 0 || actualUnits > reservation.reservation.unitsReserved) {
        await this.safeRelease(reservationToken);
        await this.repository.fail(commandLineMessageId, 'AI_USAGE_EXCEEDED_RESERVATION');
        return { status: 'FAILED', reason: 'AI_USAGE_EXCEEDED_RESERVATION' };
      }

      const providerCostUsd =
        (provider.inputTokens / 1_000_000) * config.inputUsdPerMillion +
        (provider.outputTokens / 1_000_000) * config.outputUsdPerMillion +
        mediaCost(provider.audioInputUnits, config.audioUsdPerMillion) +
        mediaCost(provider.imageInputUnits, config.imageUsdPerMillion);
      const usage: WorklogAiUsageCommit = {
        actualUnits,
        workspaceId: null,
        recordId: null,
        provider: config.provider,
        model: config.model,
        inputTokens: provider.inputTokens,
        outputTokens: provider.outputTokens,
        audioInputUnits: provider.audioInputUnits,
        imageInputUnits: provider.imageInputUnits,
        inputUsdPerMillion: config.inputUsdPerMillion,
        outputUsdPerMillion: config.outputUsdPerMillion,
        audioUsdPerMillion: config.audioUsdPerMillion,
        imageUsdPerMillion: config.imageUsdPerMillion,
        usdTwdRate: config.usdTwdRate,
        providerCostUsd,
        providerCostTwd: config.usdTwdRate === null ? null : providerCostUsd * config.usdTwdRate,
      };

      const persisted = await this.persistAfterProvider({
        claimInput,
        sourceTimestamp: input.sourceTimestamp,
        output: provider.output,
        reservationToken,
        usage,
      });
      if (persisted.status !== 'PERSISTED') return persisted.result;

      const settledUsage = { ...usage, recordId: persisted.recordId };
      return this.settleExisting(commandLineMessageId, {
        status: 'RECORD_CREATED',
        recordId: persisted.recordId,
        reservationToken,
        usage: settledUsage,
      });
    } catch (error) {
      // Once the provider returned successfully, do not release quota or overwrite
      // ingestion state after an uncertain persistence failure. The repository writes
      // record + RECORD_CREATED atomically; a later redelivery can safely inspect it.
      if (providerCompleted && reservationToken) return { status: 'IN_PROGRESS' };
      if (reservationToken) await this.safeRelease(reservationToken);
      const reason = attachmentErrorCode(error);
      await this.repository.fail(commandLineMessageId, reason);
      return { status: 'FAILED', reason };
    }
  }

  private async persistAfterProvider(input: {
    claimInput: {
      sourceId: number;
      actorUserId: number;
      commandLineMessageId: string;
      quotedLineMessageId: string;
    };
    sourceTimestamp: Date;
    output: WorklogAttachmentOutput;
    reservationToken: string;
    usage: WorklogAiUsageCommit;
  }): Promise<
    | { status: 'PERSISTED'; recordId: number }
    | { status: 'STOP'; result: WorklogAttachmentIngestionResult }
  > {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const stored = await this.repository.persistRecordCreated({
          ...input.claimInput,
          sourceTimestamp: input.sourceTimestamp,
          output: input.output,
          reservationToken: input.reservationToken,
          usage: input.usage,
        });
        if (stored.status === 'SOURCE_NOT_FOUND') {
          await this.safeRelease(input.reservationToken);
          await this.repository.fail(input.claimInput.commandLineMessageId, 'SOURCE_NOT_FOUND');
          return { status: 'STOP', result: { status: 'FAILED', reason: 'SOURCE_NOT_FOUND' } };
        }
        return { status: 'PERSISTED', recordId: stored.recordId };
      } catch {
        const recovered = await this.inspectAfterPersistenceError(input.claimInput);
        if (recovered?.status === 'SUCCEEDED') {
          return {
            status: 'STOP',
            result: { status: 'RECORDED', recordId: recovered.recordId, duplicate: true },
          };
        }
        if (recovered?.status === 'RECORD_CREATED') {
          return {
            status: 'STOP',
            result: await this.settleExisting(input.claimInput.commandLineMessageId, recovered),
          };
        }
        if (recovered?.status === 'FAILED') {
          return { status: 'STOP', result: { status: 'FAILED', reason: recovered.reason } };
        }
        if (recovered?.status !== 'PROCESSING' || attempt === 1) {
          return { status: 'STOP', result: { status: 'IN_PROGRESS' } };
        }
        // State is confidently still PROCESSING, so retry only the atomic DB
        // persistence using the provider output already in memory. Gemini is not called again.
      }
    }
    return { status: 'STOP', result: { status: 'IN_PROGRESS' } };
  }

  private async inspectAfterPersistenceError(input: {
    sourceId: number;
    actorUserId: number;
    commandLineMessageId: string;
    quotedLineMessageId: string;
  }): Promise<WorklogAttachmentClaimState | null> {
    try {
      return await this.repository.claim(input);
    } catch {
      return null;
    }
  }

  private async settleExisting(
    commandLineMessageId: string,
    state: Extract<WorklogAttachmentClaimState, { status: 'RECORD_CREATED' }>,
  ): Promise<WorklogAttachmentIngestionResult> {
    const committed = await this.subscriptions.commitAiUsage(state.reservationToken, state.usage);
    if (committed.status !== 'COMMITTED') {
      if (committed.status !== 'RESERVATION_NOT_ACTIVE' || await this.repository.reservationStatus(state.reservationToken) !== 'COMMITTED') {
        await this.repository.fail(commandLineMessageId, committed.status);
        return { status: 'FAILED', reason: committed.status };
      }
    }
    await this.repository.markSucceeded(commandLineMessageId, state.recordId);
    return { status: 'RECORDED', recordId: state.recordId, duplicate: false };
  }

  private async safeRelease(token: string): Promise<void> {
    try { await this.subscriptions.releaseAi(token); } catch { /* reservation expiry is fallback */ }
  }
}

function attachmentErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/LINE_CONTENT_UNAVAILABLE_(404|410)/.test(message)) return 'LINE_CONTENT_EXPIRED';
  if (/LINE_CONTENT_TOO_LARGE/.test(message)) return 'LINE_CONTENT_TOO_LARGE';
  if (/LINE_CONTENT_EMPTY/.test(message)) return 'LINE_CONTENT_EMPTY';
  if (/UNSUPPORTED/.test(message)) return 'ATTACHMENT_UNSUPPORTED';
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return ((error as { code: string }).code || 'ATTACHMENT_INGESTION_FAILED').slice(0, 128);
  }
  return 'ATTACHMENT_INGESTION_FAILED';
}

function mediaCost(units: number, price: number | null): number {
  if (!price || units <= 0) return 0;
  return (units / 1_000_000) * price;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function requiredText(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid ${label}`);
  return normalized;
}
