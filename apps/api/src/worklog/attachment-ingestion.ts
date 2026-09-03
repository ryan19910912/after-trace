import type { LineMessageContent } from '../line/content';
import type {
  AiPointCommitResult,
  AiPointReleaseResult,
  AiPointReservationResult,
} from './ai-point-ledger';
import { providerCostToAiPoints } from './ai-points';
import { snapshotAiUsage } from './entitlements';
import type { WorklogAiUsageCommit } from './subscription';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';

export type WorklogAttachmentInputType = 'AUDIO' | 'IMAGE' | 'FILE';

/**
 * Attachment understanding produces the durable textual Record representation only.
 * Persistent summary/category/finance metadata is intentionally not part of the
 * accepted single-title Record model. Title/time interpretation is handled by the
 * bounded Record intent/title pipeline rather than by legacy attachment categories.
 */
export type WorklogAttachmentOutput = {
  inputType: WorklogAttachmentInputType;
  rawText: string;
  attachmentMetadata: Record<string, unknown>;
};

export type WorklogAttachmentProviderResponse = {
  output: WorklogAttachmentOutput;
  /** Provider-reported total prompt tokens across all modalities. */
  inputTokens: number;
  outputTokens: number;
  /** Modality subsets of inputTokens, never additive to the total prompt count. */
  audioInputUnits: number;
  imageInputUnits: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export type WorklogAttachmentClaimState =
  | { status: 'CLAIMED' }
  | { status: 'PROCESSING' }
  | {
      status: 'PROVIDER_SUCCEEDED';
      reservationToken: string;
      usage: WorklogAiUsageCommit;
      failureReason: string;
    }
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
  /** Conservative customer-point hold estimate; a smaller positive balance may still start AI. */
  reservationUnits(content: LineMessageContent, config: WorklogAiRuntimeConfigSnapshot): number;
  analyze(
    content: LineMessageContent,
    config: WorklogAiRuntimeConfigSnapshot,
    instruction?: string | null,
  ): Promise<WorklogAttachmentProviderResponse>;
}

export interface WorklogAttachmentAiPointPort {
  reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedUnits: number;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiPointReservationResult>;
  commitAiUsage(token: string, usage: WorklogAiUsageCommit, at?: Date): Promise<AiPointCommitResult>;
  releaseAi(token: string, at?: Date): Promise<AiPointReleaseResult>;
}

export type WorklogAttachmentIngestionResult =
  | { status: 'RECORDED'; recordId: number; duplicate: boolean }
  | { status: 'IN_PROGRESS' }
  | { status: 'FAILED'; reason: string };

export class WorklogAttachmentIngestionService {
  constructor(
    private readonly repository: WorklogAttachmentRepository,
    private readonly aiPoints: WorklogAttachmentAiPointPort,
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
    if (claimed.status === 'PROVIDER_SUCCEEDED') {
      return this.settleProviderFailure(
        commandLineMessageId,
        claimed.reservationToken,
        claimed.usage,
        claimed.failureReason,
      );
    }
    if (claimed.status === 'RECORD_CREATED') return this.settleExisting(commandLineMessageId, claimed);

    let reservationToken: string | null = null;
    let providerCompleted = false;
    try {
      // Resolve only enough LINE content to distinguish a retrievable attachment from
      // an old quoted TEXT. The latter returns LINE_CONTENT_NOT_RETRIEVABLE and must
      // keep explicit re-entry guidance even when AI media capability is disabled.
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

      const requestedPoints = positiveInteger(this.provider.reservationUnits(content, config), 'requestedPoints');
      const reservation = await this.aiPoints.reserveAi({
        chargedUserId,
        actorUserId,
        sourceId,
        requestedUnits: requestedPoints,
        ttlMs: 10 * 60_000,
      });
      if (reservation.status !== 'RESERVED') {
        await this.repository.fail(commandLineMessageId, reservation.status);
        return { status: 'FAILED', reason: reservation.status };
      }
      reservationToken = reservation.reservation.token;

      const provider = await this.provider.analyze(content, config, input.instruction ?? null);
      providerCompleted = true;

      const pricingSnapshot = snapshotAiUsage({
        provider: config.provider,
        model: config.model,
        inputUsdPerMillion: config.inputUsdPerMillion,
        outputUsdPerMillion: config.outputUsdPerMillion,
        audioUsdPerMillion: config.audioUsdPerMillion,
        imageUsdPerMillion: config.imageUsdPerMillion,
        usdTwdRate: config.usdTwdRate,
      }, {
        inputTokens: provider.inputTokens,
        outputTokens: provider.outputTokens,
        audioInputUnits: provider.audioInputUnits,
        imageInputUnits: provider.imageInputUnits,
      });
      const actualPoints = providerCostToAiPoints({
        providerCostUsd: pricingSnapshot.providerCostUsd,
        outputUsdPerMillion: pricingSnapshot.outputUsdPerMillion,
      });
      const usage: WorklogAiUsageCommit = {
        // Transitional reporting field. The point ledger independently recomputes
        // actual customer points from immutable provider cost at settlement.
        actualUnits: actualPoints,
        workspaceId: null,
        recordId: null,
        ...pricingSnapshot,
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
          return {
            status: 'STOP',
            result: await this.settleProviderFailure(
              input.claimInput.commandLineMessageId,
              input.reservationToken,
              input.usage,
              'SOURCE_NOT_FOUND',
            ),
          };
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
        if (recovered?.status === 'PROVIDER_SUCCEEDED') {
          return {
            status: 'STOP',
            result: await this.settleProviderFailure(
              input.claimInput.commandLineMessageId,
              recovered.reservationToken,
              recovered.usage,
              recovered.failureReason,
            ),
          };
        }
        if (recovered?.status === 'FAILED') {
          return { status: 'STOP', result: { status: 'FAILED', reason: recovered.reason } };
        }
        if (recovered?.status !== 'PROCESSING' || attempt === 1) {
          return { status: 'STOP', result: { status: 'IN_PROGRESS' } };
        }
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
    const committed = await this.aiPoints.commitAiUsage(state.reservationToken, state.usage);
    if (committed.status !== 'COMMITTED') {
      if (await this.repository.reservationStatus(state.reservationToken) !== 'COMMITTED') {
        await this.repository.fail(commandLineMessageId, committed.status);
        return { status: 'FAILED', reason: committed.status };
      }
    }
    await this.repository.markSucceeded(commandLineMessageId, state.recordId);
    return { status: 'RECORDED', recordId: state.recordId, duplicate: false };
  }

  private async settleProviderFailure(
    commandLineMessageId: string,
    reservationToken: string,
    usage: WorklogAiUsageCommit,
    failureReason: string,
  ): Promise<WorklogAttachmentIngestionResult> {
    const committed = await this.aiPoints.commitAiUsage(reservationToken, usage);
    if (committed.status !== 'COMMITTED') {
      const reservationStatus = await this.repository.reservationStatus(reservationToken);
      if (reservationStatus !== 'COMMITTED') return { status: 'IN_PROGRESS' };
    }
    await this.repository.fail(commandLineMessageId, failureReason);
    return { status: 'FAILED', reason: failureReason };
  }

  private async safeRelease(token: string): Promise<void> {
    try { await this.aiPoints.releaseAi(token); } catch { /* reservation expiry is fallback */ }
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function requiredText(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid ${label}`);
  return normalized;
}