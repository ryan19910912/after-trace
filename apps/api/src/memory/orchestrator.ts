import type { AiBillingResult, AiBillingService, UnchargedAiUsage } from '../ai/billing';
import type { AiFundingEligibilityService } from '../ai/funding-eligibility';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import type { MemoryClassificationInputService } from './classification-input';
import { parseMemoryClassifierOutput, type MemoryClassifierPort } from './classifier-contract';
import type { MemoryClassifierResultService, ValidatedClassifierResult } from './classifier-result';
import type { MemoryCandidatePipeline } from './pipeline';
import {
  classifyMemoryAiFailure,
  defaultMemoryAiRetryPolicy,
  nextMemoryAiRetryAt,
  validateMemoryAiRetryPolicy,
  waitingMemoryAiRetryAt,
  type MemoryAiRetryPolicy,
} from './retry-policy';
import type { MemoryWorkCoordinator } from './work';

export type MemoryAiRunResult =
  | { status: 'NO_WORK' }
  | { status: 'SUCCEEDED'; requestId: number; candidateCount: number; reusedClassifierResult: boolean }
  | { status: 'WAITING_FOR_CREDIT'; requestId: number }
  | { status: 'WAITING_FOR_FREE_BUDGET'; requestId: number }
  | { status: 'DEFERRED'; requestId: number; errorCode: string }
  | { status: 'FAILED'; requestId: number; errorCode: string }
  | { status: 'STALE_CLAIM'; requestId: number };

type WorkPort = Pick<
  MemoryWorkCoordinator,
  'claimNextForGroup' | 'markSucceeded' | 'markFailed' | 'deferFailure' | 'deferTransientFailure'
>;
type InputPort = Pick<MemoryClassificationInputService, 'load'>;
type EligibilityPort = Pick<AiFundingEligibilityService, 'check'>;
type ResultPort = Pick<MemoryClassifierResultService, 'find' | 'validateAndStore'>;
type BillingPort = Pick<AiBillingService, 'chargeAndRecord'>;
type CandidatePort = Pick<MemoryCandidatePipeline, 'persist'>;

export class MemoryAiOrchestrator {
  private readonly retryPolicy: MemoryAiRetryPolicy;
  private readonly eligibility: EligibilityPort | null;

  constructor(
    private readonly work: WorkPort,
    private readonly inputs: InputPort,
    private readonly classifier: MemoryClassifierPort,
    private readonly results: ResultPort,
    private readonly billing: BillingPort,
    private readonly candidates: CandidatePort,
    private readonly runtime: AiRuntimeConfig,
    retryPolicy: MemoryAiRetryPolicy = defaultMemoryAiRetryPolicy,
    eligibility?: EligibilityPort,
  ) {
    this.retryPolicy = validateMemoryAiRetryPolicy(retryPolicy);
    this.eligibility = eligibility ?? null;
  }

  async runNextForGroup(groupId: number, now = new Date()): Promise<MemoryAiRunResult> {
    const request = await this.work.claimNextForGroup(groupId, now);
    if (!request) return { status: 'NO_WORK' };

    try {
      let durable = await this.results.find(request.id);
      const reusedClassifierResult = durable !== null;

      if (!durable && this.eligibility) {
        const funding = await this.eligibility.check(request.groupId);
        if (funding.status === 'NO_CREDIT') {
          return this.deferWait(
            request.id,
            request.attemptCount,
            now,
            'AI_INSUFFICIENT_CREDIT',
            'WAITING_FOR_CREDIT',
          );
        }
        if (funding.status === 'FREE_BUDGET_EXHAUSTED') {
          return this.deferWait(
            request.id,
            request.attemptCount,
            now,
            'AI_FREE_BUDGET_EXHAUSTED',
            'WAITING_FOR_FREE_BUDGET',
          );
        }
      }

      const classificationInput = await this.inputs.load(request);
      if (!durable) {
        const response = await this.classifier.classify(classificationInput);
        const stored = await this.results.validateAndStore({
          request,
          classificationInput,
          response,
          runtime: this.runtime,
          createdAt: new Date(),
        });
        if (stored.status === 'STALE_CLAIM') {
          return { status: 'STALE_CLAIM', requestId: request.id };
        }
        durable = stored.result;
      }

      const classified = parseMemoryClassifierOutput(durable.output, classificationInput);
      const billed = await this.bill(
        durable,
        request.groupId,
        request.actorLineUserId,
        request.origin,
        now,
      );
      if (billed.status === 'INSUFFICIENT_CREDIT') {
        return this.deferWait(
          request.id,
          request.attemptCount,
          now,
          'AI_INSUFFICIENT_CREDIT',
          'WAITING_FOR_CREDIT',
        );
      }
      if (billed.status === 'FREE_AI_BUDGET_EXHAUSTED') {
        return this.deferWait(
          request.id,
          request.attemptCount,
          now,
          'AI_FREE_BUDGET_EXHAUSTED',
          'WAITING_FOR_FREE_BUDGET',
        );
      }
      if (billed.status === 'CREDIT_REFERENCE_CONFLICT') {
        return this.fail(
          request.id,
          request.attemptCount,
          now,
          'AI_CREDIT_REFERENCE_CONFLICT',
        );
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
      return {
        status: 'SUCCEEDED',
        requestId: request.id,
        candidateCount: classified.length,
        reusedClassifierResult,
      };
    } catch (error) {
      const failure = classifyMemoryAiFailure(error);
      const nextTransientFailureCount = request.transientFailureCount + 1;
      if (
        !failure.retryable ||
        nextTransientFailureCount >= this.retryPolicy.maxTransientAttempts
      ) {
        return this.fail(request.id, request.attemptCount, now, failure.code);
      }
      return this.deferTransient(
        request.id,
        request.attemptCount,
        nextMemoryAiRetryAt(now, nextTransientFailureCount, this.retryPolicy),
        failure.code,
      );
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
    return this.billing.chargeAndRecord(
      usage,
      { type: 'AI_MEMORY_CLASSIFIER', id: String(result.requestId) },
      chargeAt,
    );
  }

  private async deferWait(
    requestId: number,
    attemptCount: number,
    now: Date,
    errorCode: string,
    status: 'WAITING_FOR_CREDIT' | 'WAITING_FOR_FREE_BUDGET',
  ): Promise<MemoryAiRunResult> {
    const deferred = await this.work.deferFailure(
      requestId,
      attemptCount,
      waitingMemoryAiRetryAt(now, this.retryPolicy),
      errorCode,
    );
    return deferred
      ? { status, requestId }
      : { status: 'STALE_CLAIM', requestId };
  }

  private async deferTransient(
    requestId: number,
    attemptCount: number,
    retryAt: Date,
    errorCode: string,
  ): Promise<MemoryAiRunResult> {
    const deferred = await this.work.deferTransientFailure(
      requestId,
      attemptCount,
      retryAt,
      errorCode,
    );
    return deferred
      ? { status: 'DEFERRED', requestId, errorCode }
      : { status: 'STALE_CLAIM', requestId };
  }

  private async fail(
    requestId: number,
    attemptCount: number,
    failedAt: Date,
    errorCode: string,
  ): Promise<MemoryAiRunResult> {
    const failed = await this.work.markFailed(requestId, attemptCount, failedAt, errorCode);
    return failed
      ? { status: 'FAILED', requestId, errorCode }
      : { status: 'STALE_CLAIM', requestId };
  }
}
