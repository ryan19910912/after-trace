import type { ProductConfig } from '../config/product';
import { numberToTwdCostUnits } from './allocation';
import type { CreditLedgerMutation, CreditReference } from './ledger';

export type RewardedAdClaim = {
  id: number;
  groupId: number;
  actorLineUserId: string;
  rewardEventId: string;
  policyDay: string;
  amountUnits: bigint;
  status: 'PENDING' | 'GRANTED' | 'REJECTED_POLICY';
  grantOperationId: number | null;
};

export interface RewardedAdRepository {
  claimReward(input: {
    groupId: number;
    actorLineUserId: string;
    rewardEventId: string;
    policyDay: string;
    amountUnits: bigint;
    dailyLimit: number;
    cooldownBoundary: Date;
    acceptedAt: Date;
  }): Promise<RewardedAdClaim>;
  completeGrant(
    grantId: number,
    operationId: number,
    at: Date,
  ): Promise<'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT'>;
}

export interface RewardedAdLedgerPort {
  grant(
    groupId: number,
    bucket: 'AD',
    amountUnits: bigint,
    reference: CreditReference,
    at?: Date,
  ): Promise<CreditLedgerMutation>;
}

export type RewardedAdResult =
  | {
      status: 'GRANTED' | 'ALREADY_GRANTED';
      grantId: number;
      operationId: number;
      amountUnits: bigint;
    }
  | { status: 'POLICY_REJECTED' | 'NO_CREDIT_CONFIGURED'; grantId: number | null }
  | {
      status: 'REFERENCE_CONFLICT' | 'PERSISTENCE_CONFLICT';
      grantId: number;
      operationId: number | null;
    };

export function rewardedAdPolicyDay(at: Date, timeZone = 'Asia/Taipei'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) {
    throw new Error('failed to resolve rewarded ad policy day');
  }
  return `${year}-${month}-${day}`;
}

export class RewardedAdService {
  constructor(
    private readonly repository: RewardedAdRepository,
    private readonly ledger: RewardedAdLedgerPort,
    private readonly config: ProductConfig,
    private readonly timeZone = 'Asia/Taipei',
  ) {}

  async grantVerifiedReward(
    groupId: number,
    actorLineUserId: string,
    rewardEventId: string,
    at = new Date(),
  ): Promise<RewardedAdResult> {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      throw new Error('groupId must be a positive safe integer');
    }
    const actor = actorLineUserId.trim();
    const eventId = rewardEventId.trim();
    if (!actor || actor.length > 64) {
      throw new Error('actorLineUserId must contain 1-64 characters');
    }
    if (!eventId || eventId.length > 128) {
      throw new Error('rewardEventId must contain 1-128 characters');
    }

    const amountUnits = numberToTwdCostUnits(this.config.credits.rewardedAdCostTwd);
    if (amountUnits === 0n) {
      return { status: 'NO_CREDIT_CONFIGURED', grantId: null };
    }

    const cooldownBoundary = new Date(
      at.getTime() - this.config.credits.rewardedAdCooldownMinutes * 60_000,
    );
    const claim = await this.repository.claimReward({
      groupId,
      actorLineUserId: actor,
      rewardEventId: eventId,
      policyDay: rewardedAdPolicyDay(at, this.timeZone),
      amountUnits,
      dailyLimit: this.config.credits.rewardedAdDailyLimit,
      cooldownBoundary,
      acceptedAt: at,
    });

    if (claim.status === 'REJECTED_POLICY') {
      return { status: 'POLICY_REJECTED', grantId: claim.id };
    }
    if (claim.status === 'GRANTED' && claim.grantOperationId !== null) {
      return {
        status: 'ALREADY_GRANTED',
        grantId: claim.id,
        operationId: claim.grantOperationId,
        amountUnits: claim.amountUnits,
      };
    }

    const grant = await this.ledger.grant(
      groupId,
      'AD',
      claim.amountUnits,
      { type: 'REWARDED_AD', id: eventId },
      at,
    );
    if (grant.status === 'REFERENCE_CONFLICT') {
      return {
        status: 'REFERENCE_CONFLICT',
        grantId: claim.id,
        operationId: grant.operationId,
      };
    }
    if (grant.status !== 'APPLIED' && grant.status !== 'ALREADY_APPLIED') {
      throw new Error(`unexpected rewarded ad grant status: ${grant.status}`);
    }
    if (grant.operationId === null) {
      throw new Error('rewarded ad grant requires an operation id');
    }

    const completion = await this.repository.completeGrant(claim.id, grant.operationId, at);
    if (completion === 'CONFLICT') {
      return {
        status: 'PERSISTENCE_CONFLICT',
        grantId: claim.id,
        operationId: grant.operationId,
      };
    }

    return {
      status:
        grant.status === 'APPLIED' && completion === 'COMPLETED'
          ? 'GRANTED'
          : 'ALREADY_GRANTED',
      grantId: claim.id,
      operationId: grant.operationId,
      amountUnits: claim.amountUnits,
    };
  }
}
