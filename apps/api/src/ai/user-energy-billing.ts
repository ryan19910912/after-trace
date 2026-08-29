import type { AiRuntimeConfig } from './runtime-config';
import type { UnchargedAiUsage } from './billing';
import type { EnergyAiUsageRepository } from './energy-usage';
import type { UserEnergyAccessRepository } from '../energy/access';
import { aiCostTwdToEnergyUnits, type AiEnergyMeter } from '../energy/ai-meter';
import type { BackgroundAiSettlementService } from '../energy/ai-settlement';
import type { UserEnergyLedgerService } from '../energy/ledger';
import type { EligibleMemorySubjectService } from '../memory/eligible-subjects';

export type UserEnergyAiBillingResult =
  | { status: 'BILLED' }
  | { status: 'INSUFFICIENT_CREDIT' }
  | { status: 'FREE_AI_BUDGET_EXHAUSTED' }
  | { status: 'CREDIT_REFERENCE_CONFLICT' };

export class UserEnergyAiBillingService {
  constructor(
    private readonly access: Pick<UserEnergyAccessRepository, 'findCaller'>,
    private readonly ledger: Pick<UserEnergyLedgerService, 'consume'>,
    private readonly eligibleSubjects: Pick<EligibleMemorySubjectService, 'listForRequest'>,
    private readonly backgroundSettlement: Pick<BackgroundAiSettlementService, 'settle'>,
    private readonly usageRepository: EnergyAiUsageRepository,
    private readonly meter: AiEnergyMeter,
    private readonly runtime: Pick<AiRuntimeConfig, 'globalFreeAiBudgetCostTwd'>,
  ) {}

  async chargeAndRecord(
    usage: UnchargedAiUsage,
    reference: { type: string; id: string },
    chargeAt = usage.createdAt,
  ): Promise<UserEnergyAiBillingResult> {
    const requestId = Number(reference.id);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      return { status: 'CREDIT_REFERENCE_CONFLICT' };
    }
    const energyUnits = aiCostTwdToEnergyUnits(usage.costTwd, this.meter);

    if (energyUnits > 0n && usage.usageType === 'MEMORY_EXTRACTION') {
      const subjects = await this.eligibleSubjects.listForRequest(requestId);
      const settlement = await this.backgroundSettlement.settle({
        requestId,
        groupId: usage.groupId,
        eligibleSubjects: subjects,
        actualCostEnergyUnits: energyUnits,
        actualCostTwd: usage.costTwd,
        globalFreeAiBudgetCostTwd: this.runtime.globalFreeAiBudgetCostTwd,
        at: chargeAt,
      });
      if (settlement.status === 'FREE_AI_BUDGET_EXHAUSTED') {
        return { status: 'FREE_AI_BUDGET_EXHAUSTED' };
      }
      if (settlement.status === 'REFERENCE_CONFLICT') {
        return { status: 'CREDIT_REFERENCE_CONFLICT' };
      }
    } else if (energyUnits > 0n) {
      if (!usage.lineUserId) return { status: 'CREDIT_REFERENCE_CONFLICT' };
      const caller = await this.access.findCaller(usage.lineUserId, chargeAt);
      if (!caller) return { status: 'INSUFFICIENT_CREDIT' };
      const charge = await this.ledger.consume({
        userId: caller.userId,
        units: energyUnits,
        at: chargeAt,
        reference: { type: reference.type, id: reference.id },
        metadata: { groupId: usage.groupId, usageType: usage.usageType },
      });
      if (charge.status === 'INSUFFICIENT_ENERGY' || charge.status === 'USER_NOT_FOUND') {
        return { status: 'INSUFFICIENT_CREDIT' };
      }
      if (charge.status === 'REFERENCE_CONFLICT') {
        return { status: 'CREDIT_REFERENCE_CONFLICT' };
      }
      if (charge.status !== 'APPLIED' && charge.status !== 'ALREADY_APPLIED') {
        return { status: 'CREDIT_REFERENCE_CONFLICT' };
      }
    }

    const recorded = await this.usageRepository.record({
      requestId,
      groupId: usage.groupId,
      usageType: usage.usageType,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      costTwd: usage.costTwd,
      energyUnits,
      latencyMs: usage.latencyMs,
      createdAt: usage.createdAt,
    });
    return recorded === 'REFERENCE_CONFLICT'
      ? { status: 'CREDIT_REFERENCE_CONFLICT' }
      : { status: 'BILLED' };
  }
}
