import { rewardedAdGrant } from './products';
import type { DrizzleUserEnergyRepository, EnergyGrantResult } from './drizzle-repository';

export const REWARDED_AD_PROVIDER = 'GOOGLE_AD_MANAGER_WEB' as const;
const NONCE_TTL_MS = 10 * 60 * 1000;

export type RewardedAdClientConfig = {
  provider: typeof REWARDED_AD_PROVIDER;
  networkCode: string;
  adUnitPath: string;
};

/**
 * Google Ad Manager Web rewarded completion is a browser event, not mobile-app SSV.
 * This adapter intentionally does not pretend the provider cryptographically verifies
 * the browser event. Security comes from authenticated LIFF identity, short-lived
 * server nonce, one-time claim, provider-event idempotency, cooldown and daily limits.
 */
export class GoogleAdManagerWebRewardedProvider {
  private readonly networkCode: string;
  private readonly adUnitPath: string;

  constructor(networkCode: string, adUnitPath: string) {
    this.networkCode = required(networkCode, 'GOOGLE_AD_MANAGER_NETWORK_CODE', 64);
    this.adUnitPath = required(adUnitPath, 'GOOGLE_AD_MANAGER_REWARDED_AD_UNIT_PATH', 256);
  }

  clientConfig(): RewardedAdClientConfig {
    return {
      provider: REWARDED_AD_PROVIDER,
      networkCode: this.networkCode,
      adUnitPath: this.adUnitPath,
    };
  }

  normalizeCompletionEvidence(providerEventId: string): { provider: typeof REWARDED_AD_PROVIDER; providerEventId: string } {
    return {
      provider: REWARDED_AD_PROVIDER,
      providerEventId: required(providerEventId, 'providerEventId', 160),
    };
  }
}

export type RewardedAdNonce = { nonce: string; expiresAt: Date };

export type RewardedAdClaimState = {
  id: number;
  userId: number;
  status: 'PENDING' | 'GRANTED' | 'REJECTED_POLICY';
  grantOperationId: number | null;
};

export type RewardedAdClaimResult =
  | { status: 'GRANTED' | 'ALREADY_GRANTED'; claimId: number; operationId: number; units: bigint }
  | { status: 'POLICY_REJECTED' | 'NONCE_INVALID' | 'USER_NOT_FOUND' }
  | { status: 'REFERENCE_CONFLICT' };

export interface UserRewardedAdRepository {
  issueNonce(input: {
    lineUserId: string;
    nonceHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<'ISSUED' | 'USER_NOT_FOUND'>;
  claim(input: {
    lineUserId: string;
    nonceHash: string;
    provider: typeof REWARDED_AD_PROVIDER;
    providerEventId: string;
    policyDay: string;
    dailyLimit: number;
    cooldownBoundary: Date;
    acceptedAt: Date;
  }): Promise<RewardedAdClaimState | { status: 'NONCE_INVALID' | 'USER_NOT_FOUND' | 'REFERENCE_CONFLICT' }>;
  completeGrant(
    claimId: number,
    operationId: number,
    grantedAt: Date,
  ): Promise<'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT'>;
}

type GrantPort = Pick<DrizzleUserEnergyRepository, 'grant'>;

export class UserRewardedAdService {
  constructor(
    private readonly repository: UserRewardedAdRepository,
    private readonly energy: GrantPort,
    private readonly provider: GoogleAdManagerWebRewardedProvider,
    private readonly rewardUnits: bigint,
    private readonly dailyLimit: number,
    private readonly cooldownMinutes: number,
    private readonly timeZone = 'Asia/Taipei',
  ) {
    if (rewardUnits <= 0n) throw new Error('Rewarded Ad Energy must be positive');
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit <= 0) throw new Error('dailyLimit must be positive');
    if (!Number.isSafeInteger(cooldownMinutes) || cooldownMinutes <= 0) throw new Error('cooldownMinutes must be positive');
  }

  async issueNonce(lineUserId: string, at = new Date()): Promise<(RewardedAdNonce & { client: RewardedAdClientConfig }) | null> {
    const user = required(lineUserId, 'lineUserId', 64);
    const nonce = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const nonceHash = await sha256Hex(nonce);
    const expiresAt = new Date(at.getTime() + NONCE_TTL_MS);
    const issued = await this.repository.issueNonce({
      lineUserId: user,
      nonceHash,
      expiresAt,
      createdAt: at,
    });
    return issued === 'USER_NOT_FOUND' ? null : { nonce, expiresAt, client: this.provider.clientConfig() };
  }

  async claim(input: {
    lineUserId: string;
    nonce: string;
    providerEventId: string;
    at?: Date;
  }): Promise<RewardedAdClaimResult> {
    const at = input.at ?? new Date();
    const lineUserId = required(input.lineUserId, 'lineUserId', 64);
    const nonce = required(input.nonce, 'nonce', 160);
    const evidence = this.provider.normalizeCompletionEvidence(input.providerEventId);
    const claim = await this.repository.claim({
      lineUserId,
      nonceHash: await sha256Hex(nonce),
      provider: evidence.provider,
      providerEventId: evidence.providerEventId,
      policyDay: policyDay(at, this.timeZone),
      dailyLimit: this.dailyLimit,
      cooldownBoundary: new Date(at.getTime() - this.cooldownMinutes * 60_000),
      acceptedAt: at,
    });

    if (!('id' in claim)) return { status: claim.status };
    if (claim.status === 'REJECTED_POLICY') return { status: 'POLICY_REJECTED' };
    if (claim.status === 'GRANTED' && claim.grantOperationId !== null) {
      return {
        status: 'ALREADY_GRANTED',
        claimId: claim.id,
        operationId: claim.grantOperationId,
        units: this.rewardUnits,
      };
    }

    const grant: EnergyGrantResult = await this.energy.grant(rewardedAdGrant({
      userId: claim.userId,
      units: this.rewardUnits,
      claimId: `claim:${claim.id}`,
      grantedAt: at,
    }));
    if (grant.status === 'REFERENCE_CONFLICT' || grant.status === 'USER_NOT_FOUND' || grant.operationId === null) {
      return { status: 'REFERENCE_CONFLICT' };
    }
    const completed = await this.repository.completeGrant(claim.id, grant.operationId, at);
    if (completed === 'CONFLICT') return { status: 'REFERENCE_CONFLICT' };
    return {
      status: grant.status === 'GRANTED' && completed === 'COMPLETED' ? 'GRANTED' : 'ALREADY_GRANTED',
      claimId: claim.id,
      operationId: grant.operationId,
      units: this.rewardUnits,
    };
  }
}

export function policyDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) throw new Error('failed to resolve rewarded-ad policy day');
  return `${year}-${month}-${day}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(new TextEncoder().encode(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function required(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}
