import type { AiBillingResult, AiBillingService, UnchargedAiUsage } from '../ai/billing';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import type { MemoryClassificationInputService } from './classification-input';
import { parseMemoryClassifierOutput, type MemoryClassifierPort } from './classifier-contract';
import type { MemoryClassifierResultService, ValidatedClassifierResult } from './classifier-result';
import type { MemoryCandidatePipeline } from './pipeline';
import type { MemoryWorkCoordinator } from './work';

export type MemoryAiRunResult =
  | { status: 'NO_WORK' }
  | { status: 'SUCCEEDED'; requestId: number; candidateCount: number; reusedClassifierResult: boolean }
  | { status: 'WAITING_FOR_CREDIT'; requestId: number }
  | { status: 'DEFERRED'; requestId: number; errorCode: string }
  | { status: 'STALE_CLAIM'; requestId: number };

type WorkPort = Pick<MemoryWorkCoordinator, 'claimNextForGroup' | 'markSucceeded' | 'deferFailure'>;
type InputPort = Pick<MemoryClassificationInputService, 'load'>;
type ResultPort = Pick<MemoryClassifierResultService, 'find' | 'validateAndStore'>;
type BillingPort = Pick<AiBillingService, 'chargeAndRecord'>;
type CandidatePort = Pick<MemoryCandidatePipeline, 'persist'>;

export class MemoryAiOrchestrator {
  constructor(
    private readonly work: WorkPort,
    private readonly inputs: InputPort,
    private readonly classifier: MemoryClassifierPort,
    private readonly results: ResultPort,
    private readonly billing: BillingPort,
    private readonly candidates: CandidatePort,
    private readonly runtime: AiRuntimeConfig,
    private readonly retryDelaySeconds = 60,
  ) {
    if (!Number.isSafeInteger(retryDelaySeconds) || retryDelaySeconds <= 0) throw new Error('retryDelaySeconds must be positive');
  }

  async runNextForGroup(groupId: number, now = new Date()): Promise<MemoryAiRunResult> {
    const request = await this.work.claimNextForGroup(groupId, now);
    if (!request) return { status: 'NO_WORK' };
    const retryAt = new Date(now.getTime() + this.retryDelaySeconds * 1_000);

    try {
      const classificationInput = await this.inputs.load(request);
      let durable = await this.results.find(request.id);
      const reusedClassifierResult = durable !== null;

      if (!durable) {
        const response = await this.classifier.classify(classificationInput);
        const stored = await this.results.validateAndStore({ request, classificationInput, response, runtime: this.runtime, createdAt: new Date() });
        if (stored.status === 'STALE_CLAIM') return { status: 'STALE_CLAIM', requestId: request.id };
        durable = stored.result;
      }

      const classified = parseMemoryClassifierOutput(durable.output, classificationInput);
      const billed = await this.bill(durable, request.groupId, request.actorLineUserId, request.origin, now);
      if (billed.status === 'INSUFFICIENT_CREDIT') {
        const deferred = await this.work.deferFailure(request.id, request.attemptCount, retryAt, 'AI_INSUFFICIENT_CREDIT');
        return deferred ? { status: 'WAITING_FOR_CREDIT', requestId: request.id } : { status: 'STALE_CLAIM', requestId: request.id };
      }
      if (billed.status === 'CREDIT_REFERENCE_CONFLICT') {
        return this.defer(request.id, request.attemptCount, retryAt, 'AI_CREDIT_REFERENCE_CONFLICT');
      }

      for (const candidate of classified) {
        await this.candidates.persist({
          requestId: request.id,
          groupId: request.groupId,
          claimAttemptCount: request.attemptCount,
          actorLineUserId: request.actorLineUserId,
          candidate,
        }, now);
      }

      const completed = await this.work.markSucceeded(request.id, request.attemptCount, now);
      if (!completed) return { status: 'STALE_CLAIM', requestId: request.id };
      return { status: 'SUCCEEDED', requestId: request.id, candidateCount: classified.length, reusedClassifierResult };
    } catch {
      return this.defer(request.id, request.attemptCount, retryAt, 'MEMORY_AI_RETRYABLE_FAILURE');
    }
  }

  private bill(
    result: ValidatedClassifierResult,
    groupId: number,
    lineUserId: string | null,
    origin: 'EXPLICIT' | 'AUTOMATIC',
    chargeAt: Date,
  ): Promise<AiBillingResult> {
    const usage: UnchargedAiUsage = {
      groupId,
      lineUserId,
      usageType: origin === 'AUTOMATIC' ? 'MEMORY_EXTRACTION' : 'EXPLICIT_MEMORY',
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      inputUsdPerMillionTokens: result.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: result.outputUsdPerMillionTokens,
      costUsd: result.costUsd,
      usdTwdRate: result.usdTwdRate,
      costTwd: result.costTwd,
      chargedCostTwd: result.costTwd,
      latencyMs: result.latencyMs,
      createdAt: result.createdAt,
    };
    return this.billing.chargeAndRecord(usage, { type: 'AI_MEMORY_CLASSIFIER', id: String(result.requestId) }, chargeAt);
  }

  private async defer(requestId: number, attemptCount: number, retryAt: Date, errorCode: string): Promise<MemoryAiRunResult> {
    const deferred = await this.work.deferFailure(requestId, attemptCount, retryAt, errorCode);
    return deferred ? { status: 'DEFERRED', requestId, errorCode } : { status: 'STALE_CLAIM', requestId };
  }
}
