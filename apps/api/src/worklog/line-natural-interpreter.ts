import type { WorklogAiPointLedgerService } from './ai-point-ledger';
import type { WorklogAiUsageCommit } from './ai-provider-usage';
import type { WorklogReplyEditTarget } from './records';
import type { WorklogAiRuntimeConfigSnapshot, WorklogTextNormalizationOutput } from './text-normalization';
import type { WorklogLineRecordEditOutput } from './line-record-edit';

export type WorklogLineNaturalInterpretation =
  | {
      intent: 'RECORD';
      content: string;
      record: WorklogTextNormalizationOutput;
    }
  | {
      intent: 'QUERY';
      queryText: string | null;
    }
  | {
      intent: 'EDIT';
      instruction: string;
      edit: WorklogLineRecordEditOutput;
    }
  | { intent: 'DELETE' }
  | { intent: 'RESTORE' }
  | { intent: 'MOVE'; title: string }
  | {
      intent: 'UNKNOWN';
      reason: string | null;
    };

export type WorklogLineNaturalInterpreterInput = {
  text: string;
  referenceOccurredAt: string;
  quotedText?: string | null;
  target?: WorklogReplyEditTarget | null;
};

export type WorklogLineNaturalInterpreterResponse = {
  interpretation: WorklogLineNaturalInterpretation;
  inputTokens: number;
  outputTokens: number;
  providerResponseId: string | null;
  latencyMs: number;
};

export interface WorklogLineNaturalInterpreterProvider {
  reservationPoints(input: WorklogLineNaturalInterpreterInput, config: WorklogAiRuntimeConfigSnapshot): number;
  interpret(input: WorklogLineNaturalInterpreterInput, config: WorklogAiRuntimeConfigSnapshot): Promise<WorklogLineNaturalInterpreterResponse>;
}

export interface WorklogLineNaturalInterpreterConfigPort {
  getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null>;
}

export type WorklogLineNaturalInterpreterResult =
  | { status: 'INTERPRETED'; interpretation: WorklogLineNaturalInterpretation }
  | { status: 'AI_POINTS_EXHAUSTED' }
  | { status: 'FAILED'; reason: string };

/** One bounded provider call per natural-language LINE text message. */
export class WorklogLineNaturalInterpreterService {
  constructor(
    private readonly config: WorklogLineNaturalInterpreterConfigPort,
    private readonly aiPoints: Pick<WorklogAiPointLedgerService, 'reserveAi' | 'commitAiUsage' | 'releaseAi'>,
    private readonly provider: WorklogLineNaturalInterpreterProvider,
  ) {}

  async interpret(input: {
    sourceId: number;
    actorUserId: number;
    chargedUserId: number;
    text: string;
    referenceOccurredAt: Date;
    quotedText?: string | null;
    target?: WorklogReplyEditTarget | null;
  }): Promise<WorklogLineNaturalInterpreterResult> {
    const config = await this.config.getRuntimeConfig();
    if (!config) return { status: 'FAILED', reason: 'AI_RUNTIME_CONFIG_MISSING' };

    const providerInput: WorklogLineNaturalInterpreterInput = {
      text: input.text,
      referenceOccurredAt: input.referenceOccurredAt.toISOString(),
      quotedText: input.quotedText ?? null,
      target: input.target ?? null,
    };

    let requestedPoints: number;
    try {
      requestedPoints = positiveInteger(this.provider.reservationPoints(providerInput, config), 'requested AI points');
    } catch {
      return { status: 'FAILED', reason: 'AI_RUNTIME_CONFIG_INVALID' };
    }

    const reservation = await this.aiPoints.reserveAi({
      chargedUserId: positiveInteger(input.chargedUserId, 'chargedUserId'),
      actorUserId: positiveInteger(input.actorUserId, 'actorUserId'),
      sourceId: positiveInteger(input.sourceId, 'sourceId'),
      requestedPoints,
      ttlMs: 10 * 60_000,
    });
    if (reservation.status !== 'RESERVED') return { status: 'AI_POINTS_EXHAUSTED' };

    const reservationToken = reservation.reservation.token;
    let response: WorklogLineNaturalInterpreterResponse;
    try {
      response = await this.provider.interpret(providerInput, config);
    } catch (error) {
      try { await this.aiPoints.releaseAi(reservationToken); } catch { /* expiry is fallback */ }
      return { status: 'FAILED', reason: errorCode(error) };
    }

    const providerCostUsd =
      (response.inputTokens / 1_000_000) * config.inputUsdPerMillion +
      (response.outputTokens / 1_000_000) * config.outputUsdPerMillion;
    const usage: WorklogAiUsageCommit = {
      operation: 'LINE_NATURAL_INTERPRET',
      provider: config.provider,
      model: config.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      audioInputUnits: 0,
      imageInputUnits: 0,
      inputUsdPerMillion: config.inputUsdPerMillion,
      outputUsdPerMillion: config.outputUsdPerMillion,
      audioUsdPerMillion: config.audioUsdPerMillion,
      imageUsdPerMillion: config.imageUsdPerMillion,
      usdTwdRate: config.usdTwdRate,
      providerCostUsd,
      providerCostTwd: config.usdTwdRate === null ? null : providerCostUsd * config.usdTwdRate,
    };
    const committed = await this.aiPoints.commitAiUsage(reservationToken, usage);
    if (committed.status !== 'COMMITTED') return { status: 'FAILED', reason: 'AI_RESERVATION_NOT_COMMITTED' };
    return { status: 'INTERPRETED', interpretation: response.interpretation };
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code.slice(0, 128);
  }
  return 'LINE_NATURAL_INTERPRET_FAILED';
}
