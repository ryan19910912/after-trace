import { numberToTwdCostUnits } from '../credits/allocation';

export type AiFundingSnapshot = {
  welcomeAvailableUnits: bigint;
  adAvailableUnits: bigint;
  paidAvailableUnits: bigint;
  globalFreeAiSpentUnits: bigint;
};

export interface AiFundingSnapshotRepository {
  load(groupId: number, at: Date): Promise<AiFundingSnapshot>;
}

export type AiFundingEligibility =
  | {
      status: 'ELIGIBLE';
      usableFreeUnits: bigint;
      paidAvailableUnits: bigint;
      remainingGlobalFreeBudgetUnits: bigint;
    }
  | {
      status: 'NO_CREDIT';
      usableFreeUnits: 0n;
      paidAvailableUnits: 0n;
      remainingGlobalFreeBudgetUnits: bigint;
    }
  | {
      status: 'FREE_BUDGET_EXHAUSTED';
      usableFreeUnits: 0n;
      paidAvailableUnits: 0n;
      remainingGlobalFreeBudgetUnits: 0n;
    };

export class AiFundingEligibilityService {
  private readonly globalBudgetUnits: bigint;

  constructor(
    private readonly repository: AiFundingSnapshotRepository,
    globalFreeAiBudgetCostTwd: number,
  ) {
    this.globalBudgetUnits = numberToTwdCostUnits(globalFreeAiBudgetCostTwd);
    if (this.globalBudgetUnits <= 0n) {
      throw new Error('globalFreeAiBudgetCostTwd must be greater than zero');
    }
  }

  async check(groupId: number, at = new Date()): Promise<AiFundingEligibility> {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      throw new Error('groupId must be a positive safe integer');
    }

    const snapshot = await this.repository.load(groupId, at);
    assertNonNegative(snapshot.welcomeAvailableUnits, 'welcomeAvailableUnits');
    assertNonNegative(snapshot.adAvailableUnits, 'adAvailableUnits');
    assertNonNegative(snapshot.paidAvailableUnits, 'paidAvailableUnits');
    assertNonNegative(snapshot.globalFreeAiSpentUnits, 'globalFreeAiSpentUnits');

    const remainingGlobalFreeBudgetUnits =
      snapshot.globalFreeAiSpentUnits >= this.globalBudgetUnits
        ? 0n
        : this.globalBudgetUnits - snapshot.globalFreeAiSpentUnits;
    const groupFreeUnits = snapshot.welcomeAvailableUnits + snapshot.adAvailableUnits;
    const usableFreeUnits = minBigInt(groupFreeUnits, remainingGlobalFreeBudgetUnits);

    if (usableFreeUnits > 0n || snapshot.paidAvailableUnits > 0n) {
      return {
        status: 'ELIGIBLE',
        usableFreeUnits,
        paidAvailableUnits: snapshot.paidAvailableUnits,
        remainingGlobalFreeBudgetUnits,
      };
    }

    if (groupFreeUnits > 0n && remainingGlobalFreeBudgetUnits === 0n) {
      return {
        status: 'FREE_BUDGET_EXHAUSTED',
        usableFreeUnits: 0n,
        paidAvailableUnits: 0n,
        remainingGlobalFreeBudgetUnits: 0n,
      };
    }

    return {
      status: 'NO_CREDIT',
      usableFreeUnits: 0n,
      paidAvailableUnits: 0n,
      remainingGlobalFreeBudgetUnits,
    };
  }
}

function assertNonNegative(value: bigint, name: string): void {
  if (value < 0n) throw new Error(`${name} must be non-negative`);
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
