import { allocateBackgroundCharge, type BackgroundParticipant } from './background';
import type { EligibleMemorySubject } from '../memory/eligible-subjects';

export type BackgroundAiChargeShare = {
  userId: number;
  lineUserId: string;
  allocatedUnits: bigint;
};

export type BackgroundAiSettlementStatus =
  | 'SETTLED'
  | 'ALREADY_SETTLED'
  | 'FREE_AI_BUDGET_EXHAUSTED'
  | 'REFERENCE_CONFLICT';

export type BackgroundAiSettlementResult = {
  status: BackgroundAiSettlementStatus;
  userChargedUnits: bigint;
  platformSubsidyUnits: bigint;
};

export interface BackgroundAiSettlementRepository {
  settle(input: {
    requestId: number;
    groupId: number;
    shares: readonly BackgroundAiChargeShare[];
    totalEnergyUnits: bigint;
    totalCostTwd: string;
    globalFreeAiBudgetCostTwd: string;
    at: Date;
  }): Promise<BackgroundAiSettlementResult>;
}

export class BackgroundAiSettlementService {
  constructor(private readonly repository: BackgroundAiSettlementRepository) {}

  settle(input: {
    requestId: number;
    groupId: number;
    eligibleSubjects: readonly EligibleMemorySubject[];
    actualCostEnergyUnits: bigint;
    actualCostTwd: string;
    globalFreeAiBudgetCostTwd: number;
    at?: Date;
  }): Promise<BackgroundAiSettlementResult> {
    if (!Number.isSafeInteger(input.requestId) || input.requestId <= 0) {
      throw new Error('requestId must be a positive safe integer');
    }
    if (!Number.isSafeInteger(input.groupId) || input.groupId <= 0) {
      throw new Error('groupId must be a positive safe integer');
    }
    if (input.actualCostEnergyUnits < 0n) throw new Error('actualCostEnergyUnits must be non-negative');
    if (!Number.isFinite(input.globalFreeAiBudgetCostTwd) || input.globalFreeAiBudgetCostTwd <= 0) {
      throw new Error('globalFreeAiBudgetCostTwd must be positive');
    }

    const participants: BackgroundParticipant[] = input.eligibleSubjects.map((subject) => ({
      lineUserId: subject.lineUserId,
      normalizedCharCount: subject.normalizedCharCount,
      availableEnergyUnits: subject.preflightAvailableUnits,
    }));
    const allocations = allocateBackgroundCharge(participants, input.actualCostEnergyUnits);
    const userIdByLineId = new Map(input.eligibleSubjects.map((subject) => [subject.lineUserId, subject.userId]));
    const shares = allocations.map((allocation) => {
      const userId = userIdByLineId.get(allocation.lineUserId);
      if (!userId) throw new Error('background allocation lost eligible user identity');
      return {
        userId,
        lineUserId: allocation.lineUserId,
        allocatedUnits: allocation.allocatedUnits,
      };
    });

    return this.repository.settle({
      requestId: input.requestId,
      groupId: input.groupId,
      shares,
      totalEnergyUnits: input.actualCostEnergyUnits,
      totalCostTwd: input.actualCostTwd,
      globalFreeAiBudgetCostTwd: input.globalFreeAiBudgetCostTwd.toFixed(8),
      at: input.at ?? new Date(),
    });
  }
}
