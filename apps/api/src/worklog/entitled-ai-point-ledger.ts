import type {
  AiPointCommitResult,
  AiPointReleaseResult,
  AiPointReservationResult,
} from './ai-point-ledger';
import { AiEntitlementService } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';

export interface AiPointLedgerPort {
  reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedPoints: number;
    providerCostHoldTwd?: number | null;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiPointReservationResult>;
  commitAiUsage(token: string, usage: WorklogAiUsageCommit, at?: Date): Promise<AiPointCommitResult>;
  releaseAi(token: string, at?: Date): Promise<AiPointReleaseResult>;
}

/**
 * Shared provider-facing AI point port.
 *
 * Every provider call must pass per-user Source authorization + FREE_TRIAL/AI_PRO
 * admission before the low-level reservation ledger runs. The entitlement repository
 * activates only the selected user-owned grant scope for this Source, preventing a paid
 * period from accidentally consuming an older FREE trial (or another legacy grant).
 *
 * AI Pro additionally requires a conservative TWD provider-cost hold from the exact
 * provider/runtime pricing snapshot used to estimate the request. FREE trial does not use
 * the monthly paid hard cap, so its low-level reservation intentionally receives no TWD hold.
 */
export class EntitledAiPointLedgerService implements AiPointLedgerPort {
  constructor(
    private readonly entitlement: AiEntitlementService,
    private readonly ledger: AiPointLedgerPort,
  ) {}

  async reserveAi(input: Parameters<AiPointLedgerPort['reserveAi']>[0]): Promise<AiPointReservationResult> {
    const sourceId = positiveInteger(input.sourceId, 'sourceId');
    const at = input.at ?? new Date();
    const admission = await this.entitlement.admitWithGrant(
      positiveInteger(input.chargedUserId, 'chargedUserId'),
      sourceId,
      positiveInteger(input.requestedPoints, 'requestedPoints'),
      at,
    );
    if (!admission.decision.allowed || admission.grantId === null) {
      return { status: 'AI_ENTITLEMENT_BLOCKED', reason: admission.decision.reason };
    }

    const providerCostHoldTwd = admission.decision.source === 'AI_PRO'
      ? positiveProviderCostHold(input.providerCostHoldTwd)
      : null;
    if (admission.decision.source === 'AI_PRO' && providerCostHoldTwd === null) {
      return { status: 'AI_ENTITLEMENT_BLOCKED', reason: 'PROVIDER_COST_ACCOUNTING_INCOMPLETE' };
    }

    return this.ledger.reserveAi({ ...input, sourceId, at, providerCostHoldTwd });
  }

  commitAiUsage(token: string, usage: WorklogAiUsageCommit, at?: Date): Promise<AiPointCommitResult> {
    return this.ledger.commitAiUsage(token, usage, at);
  }

  releaseAi(token: string, at?: Date): Promise<AiPointReleaseResult> {
    return this.ledger.releaseAi(token, at);
  }
}

function positiveInteger(value: number | null | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value as number;
}

function positiveProviderCostHold(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
