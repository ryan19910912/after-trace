import { calculateAiCost } from '../ai/cost';
import { DrizzleEnergyAiUsageRepository } from '../ai/energy-usage';
import { resolveAiRuntimeConfig, type AiRuntimeEnv } from '../ai/runtime-config';
import { UserEnergyAiBillingService } from '../ai/user-energy-billing';
import type { Database } from '../db/client';
import { resolveAiEnergyMeter, type AiEnergyMeterEnv } from '../energy/ai-meter';
import { BackgroundAiSettlementService } from '../energy/ai-settlement';
import { DrizzleUserEnergyAccessRepository } from '../energy/drizzle-access';
import { DrizzleReservedBackgroundAiSettlementRepository } from '../energy/drizzle-ai-settlement-reserved';
import { DrizzleUserEnergyMutationRepository } from '../energy/drizzle-mutations';
import { UserEnergyLedgerService } from '../energy/ledger';
import { DrizzlePlatformAiBudgetReservationRepository } from '../energy/platform-budget';
import { ExtractionBatchInputService } from '../extraction/input';
import { DrizzleExtractionInputRepository } from '../extraction/drizzle-input-repository';
import { MemoryClassificationInputService, type MemoryClassificationInput } from './classification-input';
import { parseMemoryClassifierOutput } from './classifier-contract';
import { buildMemoryClassifierPrompt } from './classifier-prompt';
import { MemoryClassifierResultService } from './classifier-result';
import { DrizzleMemoryClassifierResultRepository } from './drizzle-classifier-result-repository';
import { DrizzleMemorySourceMessageRepository } from './drizzle-classification-input-repository';
import { DrizzleEligibleMemorySubjectRepository } from './drizzle-eligible-subjects';
import { DrizzleMemoryCandidateRepository } from './drizzle-pipeline-repository';
import { DrizzleMemoryWorkRepository } from './drizzle-work-repository';
import { EligibleMemorySubjectService } from './eligible-subjects';
import { GeminiMemoryClassifier } from './gemini-classifier';
import { MemoryCandidatePipeline } from './pipeline';
import {
  classifyMemoryAiFailure,
  defaultMemoryAiRetryPolicy,
  nextMemoryAiRetryAt,
  waitingMemoryAiRetryAt,
} from './retry-policy';
import { MemoryWorkCoordinator, type ClaimedMemoryRequest } from './work';

export type MemoryAiRuntimeEnv = AiRuntimeEnv & AiEnergyMeterEnv & {
  GEMINI_API_KEY?: string;
  GEMINI_MEMORY_MAX_OUTPUT_TOKENS?: string;
  MEMORY_REQUEST_LEASE_SECONDS?: string;
  BACKGROUND_AI_MAX_SUBSIDY_COST_TWD?: string;
};

export type MemoryAiRuntimeResult =
  | { status: 'DISABLED'; reason: string }
  | { status: 'NO_WORK' }
  | { status: 'SUCCEEDED'; requestId: number; candidateCount: number; reusedClassifierResult: boolean }
  | { status: 'WAITING_FOR_CREDIT'; requestId: number }
  | { status: 'WAITING_FOR_FREE_BUDGET'; requestId: number }
  | { status: 'DEFERRED'; requestId: number; errorCode: string }
  | { status: 'FAILED'; requestId: number; errorCode: string }
  | { status: 'STALE_CLAIM'; requestId: number };

function requiredPositiveNumber(name: string, value: string | undefined): number {
  if (!value?.trim()) throw new Error(`${name} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function requiredPositiveInteger(name: string, value: string | undefined): number {
  if (!value?.trim()) throw new Error(`${name} is required`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function leaseSeconds(value: string | undefined): number {
  if (!value?.trim()) return 120;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('MEMORY_REQUEST_LEASE_SECONDS must be a positive integer');
  return parsed;
}

export class UserEnergyMemoryAiRuntime {
  private readonly work: MemoryWorkCoordinator;
  private readonly inputs: MemoryClassificationInputService;
  private readonly classifier: GeminiMemoryClassifier;
  private readonly results: MemoryClassifierResultService;
  private readonly billing: UserEnergyAiBillingService;
  private readonly candidates: MemoryCandidatePipeline;
  private readonly access: DrizzleUserEnergyAccessRepository;
  private readonly budget: DrizzlePlatformAiBudgetReservationRepository;
  private readonly runtime;
  private readonly maxBackgroundSubsidyCostTwd: number;
  private readonly maxMemoryOutputTokens: number;

  constructor(database: Database, env: MemoryAiRuntimeEnv) {
    this.runtime = resolveAiRuntimeConfig(env);
    const meter = resolveAiEnergyMeter(env);
    const eligibleSubjects = new EligibleMemorySubjectService(
      new DrizzleEligibleMemorySubjectRepository(database),
    );
    this.work = new MemoryWorkCoordinator(
      new DrizzleMemoryWorkRepository(database),
      leaseSeconds(env.MEMORY_REQUEST_LEASE_SECONDS),
    );
    this.candidates = new MemoryCandidatePipeline(new DrizzleMemoryCandidateRepository(database));
    this.inputs = new MemoryClassificationInputService(
      new ExtractionBatchInputService(new DrizzleExtractionInputRepository(database)),
      new DrizzleMemorySourceMessageRepository(database),
      this.candidates,
      eligibleSubjects,
    );
    this.maxMemoryOutputTokens = requiredPositiveInteger(
      'GEMINI_MEMORY_MAX_OUTPUT_TOKENS',
      env.GEMINI_MEMORY_MAX_OUTPUT_TOKENS,
    );
    this.classifier = new GeminiMemoryClassifier({
      apiKey: env.GEMINI_API_KEY?.trim() ?? '',
      model: this.runtime.model,
      maxOutputTokens: this.maxMemoryOutputTokens,
    });
    this.results = new MemoryClassifierResultService(
      new DrizzleMemoryClassifierResultRepository(database),
    );
    this.access = new DrizzleUserEnergyAccessRepository(database);
    this.budget = new DrizzlePlatformAiBudgetReservationRepository(database);
    this.maxBackgroundSubsidyCostTwd = requiredPositiveNumber(
      'BACKGROUND_AI_MAX_SUBSIDY_COST_TWD',
      env.BACKGROUND_AI_MAX_SUBSIDY_COST_TWD,
    );
    const ledger = new UserEnergyLedgerService(new DrizzleUserEnergyMutationRepository(database));
    this.billing = new UserEnergyAiBillingService(
      this.access,
      ledger,
      eligibleSubjects,
      new BackgroundAiSettlementService(
        new DrizzleReservedBackgroundAiSettlementRepository(database),
      ),
      new DrizzleEnergyAiUsageRepository(database),
      meter,
      this.runtime,
    );
  }

  async runNextForGroup(groupId: number, now = new Date()): Promise<MemoryAiRuntimeResult> {
    const request = await this.work.claimNextForGroup(groupId, now);
    if (!request) return { status: 'NO_WORK' };

    let durable = await this.results.find(request.id);
    const reusedClassifierResult = durable !== null;
    let budgetReservedThisAttempt = false;

    try {
      if (!durable) {
        // Explicit work checks the caller before loading group context. Automatic work
        // already has an eligible-subject snapshot, but still needs the concrete prompt
        // to compute a conservative provider-cost upper bound before Gemini.
        if (request.origin === 'EXPLICIT') {
          const explicitFunding = await this.preflightExplicitCaller(request, now);
          if (!explicitFunding) {
            return this.deferWait(request, now, 'AI_INSUFFICIENT_CREDIT', 'WAITING_FOR_CREDIT');
          }
        }

        const classificationInput = await this.inputs.load(request);
        if (request.origin === 'AUTOMATIC') {
          const budgetStatus = await this.reserveAutomaticProviderRisk(request, classificationInput, now);
          if (budgetStatus !== 'RESERVED') {
            return this.deferWait(
              request,
              now,
              budgetStatus === 'RISK_CAP_EXCEEDED'
                ? 'AI_BACKGROUND_RISK_CAP_EXCEEDED'
                : 'AI_FREE_BUDGET_EXHAUSTED',
              'WAITING_FOR_FREE_BUDGET',
            );
          }
          budgetReservedThisAttempt = true;
        }

        const response = await this.classifier.classify(classificationInput);
        const stored = await this.results.validateAndStore({
          request,
          classificationInput,
          response,
          runtime: this.runtime,
          createdAt: new Date(),
        });
        if (stored.status === 'STALE_CLAIM') {
          if (budgetReservedThisAttempt) await this.budget.release(request.id, new Date());
          return { status: 'STALE_CLAIM', requestId: request.id };
        }
        durable = stored.result;
      }

      const classificationInput = await this.inputs.load(request);
      const classified = parseMemoryClassifierOutput(durable.output, classificationInput);
      const billed = await this.billing.chargeAndRecord({
        groupId: request.groupId,
        lineUserId: request.actorLineUserId,
        usageType: request.origin === 'AUTOMATIC' ? 'MEMORY_EXTRACTION' : 'EXPLICIT_MEMORY',
        provider: durable.provider,
        model: durable.model,
        inputTokens: durable.inputTokens,
        outputTokens: durable.outputTokens,
        inputUsdPerMillionTokens: durable.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: durable.outputUsdPerMillionTokens,
        costUsd: durable.costUsd,
        usdTwdRate: durable.usdTwdRate,
        costTwd: durable.costTwd,
        chargedCostTwd: durable.costTwd,
        latencyMs: durable.latencyMs,
        createdAt: durable.createdAt,
      }, { type: 'AI_MEMORY_CLASSIFIER', id: String(request.id) }, now);

      if (billed.status === 'INSUFFICIENT_CREDIT') {
        return this.deferWait(request, now, 'AI_INSUFFICIENT_CREDIT', 'WAITING_FOR_CREDIT');
      }
      if (billed.status === 'FREE_AI_BUDGET_EXHAUSTED') {
        return this.deferWait(request, now, 'AI_FREE_BUDGET_EXHAUSTED', 'WAITING_FOR_FREE_BUDGET');
      }
      if (billed.status === 'CREDIT_REFERENCE_CONFLICT') {
        return this.fail(request, now, 'AI_ENERGY_REFERENCE_CONFLICT');
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
      if (!durable && budgetReservedThisAttempt) {
        await this.budget.release(request.id, new Date()).catch(() => undefined);
      }
      const failure = classifyMemoryAiFailure(error);
      const nextCount = request.transientFailureCount + 1;
      if (!failure.retryable || nextCount >= defaultMemoryAiRetryPolicy.maxTransientAttempts) {
        return this.fail(request, now, failure.code);
      }
      const retryAt = nextMemoryAiRetryAt(now, nextCount, defaultMemoryAiRetryPolicy);
      const deferred = await this.work.deferTransientFailure(
        request.id,
        request.attemptCount,
        retryAt,
        failure.code,
      );
      return deferred
        ? { status: 'DEFERRED', requestId: request.id, errorCode: failure.code }
        : { status: 'STALE_CLAIM', requestId: request.id };
    }
  }

  private async preflightExplicitCaller(request: ClaimedMemoryRequest, at: Date): Promise<boolean> {
    if (!request.actorLineUserId) return false;
    const caller = await this.access.findCaller(request.actorLineUserId, at);
    return Boolean(caller && caller.usableUnits > 0n);
  }

  private async reserveAutomaticProviderRisk(
    request: ClaimedMemoryRequest,
    input: MemoryClassificationInput,
    at: Date,
  ): Promise<'RESERVED' | 'RISK_CAP_EXCEEDED' | 'FREE_BUDGET_EXHAUSTED'> {
    const prompt = buildMemoryClassifierPrompt(input);
    const encoder = new TextEncoder();
    const inputUpperBoundTokens =
      encoder.encode(prompt.systemInstruction).byteLength
      + encoder.encode(prompt.userPrompt).byteLength;
    const worstCase = calculateAiCost(
      {
        inputTokens: inputUpperBoundTokens,
        outputTokens: this.maxMemoryOutputTokens,
      },
      this.runtime.pricing,
    );

    // The configured per-call cap is an operator safety ceiling, never a substitute
    // for the computed risk. If the concrete request can exceed it, Gemini is not called.
    if (worstCase.costTwd > this.maxBackgroundSubsidyCostTwd) {
      return 'RISK_CAP_EXCEEDED';
    }

    // Worst case assumes the platform may need to subsidize the entire provider call.
    // Reserving the full computed provider cost makes the global free-AI ceiling a true
    // pre-invocation hard gate even if eligible users exhaust their Energy before settle.
    const reservation = await this.budget.reserve({
      requestId: request.id,
      groupId: request.groupId,
      maxSubsidyCostTwd: worstCase.costTwd,
      globalBudgetCostTwd: this.runtime.globalFreeAiBudgetCostTwd,
      at,
    });
    return reservation.status === 'RESERVED' || reservation.status === 'ALREADY_RESERVED'
      ? 'RESERVED'
      : 'FREE_BUDGET_EXHAUSTED';
  }

  private async deferWait(
    request: ClaimedMemoryRequest,
    now: Date,
    code: string,
    status: 'WAITING_FOR_CREDIT' | 'WAITING_FOR_FREE_BUDGET',
  ): Promise<MemoryAiRuntimeResult> {
    const deferred = await this.work.deferFailure(
      request.id,
      request.attemptCount,
      waitingMemoryAiRetryAt(now, defaultMemoryAiRetryPolicy),
      code,
    );
    return deferred ? { status, requestId: request.id } : { status: 'STALE_CLAIM', requestId: request.id };
  }

  private async fail(
    request: ClaimedMemoryRequest,
    at: Date,
    errorCode: string,
  ): Promise<MemoryAiRuntimeResult> {
    const failed = await this.work.markFailed(request.id, request.attemptCount, at, errorCode);
    return failed
      ? { status: 'FAILED', requestId: request.id, errorCode }
      : { status: 'STALE_CLAIM', requestId: request.id };
  }
}

export function memoryAiRuntimeDisabledReason(env: MemoryAiRuntimeEnv): string | null {
  const required = [
    'GEMINI_API_KEY',
    'GEMINI_INPUT_USD_PER_MILLION_TOKENS',
    'GEMINI_OUTPUT_USD_PER_MILLION_TOKENS',
    'GEMINI_MEMORY_MAX_OUTPUT_TOKENS',
    'USD_TWD_RATE',
    'GLOBAL_FREE_AI_BUDGET_COST_TWD',
    'ENERGY_UNITS_PER_TWD',
    'BACKGROUND_AI_MAX_SUBSIDY_COST_TWD',
  ] as const;
  const missing = required.filter((key) => !env[key]?.trim());
  return missing.length === 0 ? null : `missing runtime config: ${missing.join(', ')}`;
}
