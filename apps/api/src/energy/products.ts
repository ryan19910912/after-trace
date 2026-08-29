import { adExpiry, type EnergyBucket } from './model';

export type PaidPackCode = 'SMALL' | 'MEDIUM' | 'LARGE';

export type EnergyGrantRequest = {
  userId: number;
  bucket: EnergyBucket;
  units: bigint;
  sourceType: 'FREE_LIFETIME' | 'SUBSCRIPTION_CYCLE' | 'REWARDED_AD' | 'PAID_PURCHASE';
  sourceId: string;
  expiresAt: Date | null;
  metadata?: Record<string, unknown>;
};

function positiveUnits(units: bigint): bigint {
  if (units <= 0n) throw new Error('Energy grant units must be positive');
  return units;
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export function lifetimeFreeGrant(userId: number, units: bigint): EnergyGrantRequest {
  return {
    userId,
    bucket: 'FREE',
    units: positiveUnits(units),
    sourceType: 'FREE_LIFETIME',
    sourceId: 'V1',
    expiresAt: null,
  };
}

export function subscriptionCycleGrant(input: {
  userId: number;
  units: bigint;
  provider: string;
  subscriptionId: string;
  cycleId: string;
  periodStart: Date;
  periodEnd: Date;
}): EnergyGrantRequest {
  if (input.periodEnd.getTime() <= input.periodStart.getTime()) {
    throw new Error('subscription period_end must be after period_start');
  }
  const provider = nonEmpty(input.provider, 'provider');
  const cycleId = nonEmpty(input.cycleId, 'cycleId');
  return {
    userId: input.userId,
    bucket: 'SUBSCRIPTION',
    units: positiveUnits(input.units),
    sourceType: 'SUBSCRIPTION_CYCLE',
    sourceId: `${provider}:${cycleId}`,
    expiresAt: input.periodEnd,
    metadata: {
      provider,
      subscriptionId: nonEmpty(input.subscriptionId, 'subscriptionId'),
      cycleId,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
    },
  };
}

export function rewardedAdGrant(input: {
  userId: number;
  units: bigint;
  claimId: string;
  grantedAt: Date;
}): EnergyGrantRequest {
  return {
    userId: input.userId,
    bucket: 'AD',
    units: positiveUnits(input.units),
    sourceType: 'REWARDED_AD',
    sourceId: nonEmpty(input.claimId, 'claimId'),
    expiresAt: adExpiry(input.grantedAt),
  };
}

export function paidPackGrant(input: {
  userId: number;
  units: bigint;
  provider: string;
  providerPurchaseId: string;
  packCode: PaidPackCode;
}): EnergyGrantRequest {
  const provider = nonEmpty(input.provider, 'provider');
  const purchaseId = nonEmpty(input.providerPurchaseId, 'providerPurchaseId');
  return {
    userId: input.userId,
    bucket: 'PAID',
    units: positiveUnits(input.units),
    sourceType: 'PAID_PURCHASE',
    sourceId: `${provider}:${purchaseId}`,
    expiresAt: null,
    metadata: { provider, providerPurchaseId: purchaseId, packCode: input.packCode },
  };
}
