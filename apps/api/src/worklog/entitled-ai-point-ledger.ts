import type {
  AiPointCommitResult,
  AiPointReleaseResult,
  AiPointReservationResult,
  WorklogAiPointLedgerService,
} from './ai-point-ledger';
import { AiEntitlementService } from './ai-entitlement';
import type { WorklogAiUsageCommit } from './ai-provider-usage';

/**
 * Shared provider-facing AI point port.
 *
 * Every provider call must pass per-user Source authorization + FREE_TRIAL/AI_PRO
 * admission before the low-level reservation ledger runs. The entitlement repository
 * activates only the selected user-owned grant scope for this Source, preventing a paid
 * period from accidentally consuming an older FREE trial (or another legacy grant).
 */
export class EntitledAiPointLedgerService {
  constructor(
    private readonly entitlement: AiEntitlementService,
    private readonly ledger: WorklogAiPointLedgerService,
  ) {}

  async reserveAi(input: {
    chargedUserId: number;
    actorUserId: number;
    sourceId?: number | null;
    requestedPoints: number;
    at?: Date;
    ttlMs?: number;
  }): Promise<AiPointReservationResult> {
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
    return this.ledger.reserveAi({ ...input, sourceId, at });
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
