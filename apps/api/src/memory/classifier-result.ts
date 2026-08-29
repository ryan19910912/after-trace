import { calculateAiCost } from '../ai/cost';
import type { AiRuntimeConfig } from '../ai/runtime-config';
import type { MemoryClassificationInput } from './classification-input';
import {
  parseMemoryClassifierOutput,
  type MemoryClassifierOutput,
  type MemoryClassifierResponse,
} from './classifier-contract';
import type { ClaimedMemoryRequest } from './work';

export type ValidatedClassifierResult = {
  requestId: number;
  attemptCount: number;
  provider: 'GOOGLE';
  model: string;
  providerResponseId: string | null;
  output: MemoryClassifierOutput;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
  inputUsdPerMillionTokens: string;
  outputUsdPerMillionTokens: string;
  usdTwdRate: string;
  costUsd: string;
  costTwd: string;
  createdAt: Date;
};

export type ClassifierResultStoreOutcome =
  | { status: 'STORED'; result: ValidatedClassifierResult }
  | { status: 'ALREADY_STORED'; result: ValidatedClassifierResult }
  | { status: 'STALE_CLAIM' };

export interface MemoryClassifierResultRepository {
  findByRequestId(requestId: number): Promise<ValidatedClassifierResult | null>;
  storeIfCurrent(input: {
    groupId: number;
    requestId: number;
    attemptCount: number;
    result: ValidatedClassifierResult;
  }): Promise<ClassifierResultStoreOutcome>;
}

export class MemoryClassifierResultService {
  constructor(private readonly repository: MemoryClassifierResultRepository) {}

  find(requestId: number): Promise<ValidatedClassifierResult | null> {
    assertPositiveSafeInteger(requestId, 'requestId');
    return this.repository.findByRequestId(requestId);
  }

  async validateAndStore(input: {
    request: ClaimedMemoryRequest;
    classificationInput: MemoryClassificationInput;
    response: MemoryClassifierResponse;
    runtime: AiRuntimeConfig;
    createdAt?: Date;
  }): Promise<ClassifierResultStoreOutcome> {
    if (input.request.id !== input.classificationInput.requestId) {
      throw new Error('classifier input belongs to another memory request');
    }
    if (input.request.groupId !== input.classificationInput.groupId) {
      throw new Error('classifier input belongs to another group');
    }
    if (input.response.model !== input.runtime.model) {
      throw new Error('classifier response model does not match the configured billing snapshot');
    }

    parseMemoryClassifierOutput(input.response.output, input.classificationInput);
    const cost = calculateAiCost(input.response.tokenUsage, input.runtime.pricing);
    const createdAt = input.createdAt ?? new Date();
    const result: ValidatedClassifierResult = {
      requestId: input.request.id,
      attemptCount: input.request.attemptCount,
      provider: input.runtime.provider,
      model: input.response.model,
      providerResponseId: input.response.providerResponseId ?? null,
      output: input.response.output,
      inputTokens: input.response.tokenUsage.inputTokens,
      outputTokens: input.response.tokenUsage.outputTokens,
      latencyMs: input.response.latencyMs,
      inputUsdPerMillionTokens: decimal(input.runtime.pricing.inputUsdPerMillionTokens, 10),
      outputUsdPerMillionTokens: decimal(input.runtime.pricing.outputUsdPerMillionTokens, 10),
      usdTwdRate: decimal(input.runtime.pricing.usdTwdRate, 6),
      costUsd: decimal(cost.costUsd, 10),
      costTwd: decimal(cost.costTwd, 8),
      createdAt,
    };

    return this.repository.storeIfCurrent({
      groupId: input.request.groupId,
      requestId: input.request.id,
      attemptCount: input.request.attemptCount,
      result,
    });
  }
}

function decimal(value: number, scale: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('AI cost snapshot must be non-negative');
  return value.toFixed(scale);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}
