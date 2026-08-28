import type { ProductConfig } from '../config/product';
import { numberToTwdCostUnits } from './allocation';
import type { CreditLedgerMutation, CreditReference } from './ledger';

export type WelcomeAttribution = {
  id: number;
  groupId: number;
  lineUserId: string;
  isFirstGroup: boolean;
  amountUnits: bigint;
  grantOperationId: number | null;
  state: 'CREATED' | 'EXISTING';
};

export interface WelcomeCreditRepository {
  claimAttribution(
    groupId: number,
    lineUserId: string,
    firstAmountUnits: bigint,
    laterAmountUnits: bigint,
    at: Date,
  ): Promise<WelcomeAttribution>;
  completeAttribution(
    attributionId: number,
    operationId: number,
    at: Date,
  ): Promise<'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT'>;
}

export interface WelcomeCreditLedgerPort {
  grant(
    groupId: number,
    bucket: 'WELCOME',
    amountUnits: bigint,
    reference: CreditReference,
    at?: Date,
  ): Promise<CreditLedgerMutation>;
}

export type WelcomeCreditResult = {
  status:
    | 'GRANTED'
    | 'ALREADY_GRANTED'
    | 'NO_CREDIT_CONFIGURED'
    | 'REFERENCE_CONFLICT'
    | 'PERSISTENCE_CONFLICT';
  attributionId: number;
  isFirstGroup: boolean;
  amountUnits: bigint;
  operationId: number | null;
};

export class WelcomeCreditService {
  constructor(
    private readonly repository: WelcomeCreditRepository,
    private readonly ledger: WelcomeCreditLedgerPort,
    private readonly config: ProductConfig,
  ) {}

  async ensureForObservedMember(
    groupId: number,
    lineUserId: string,
    at = new Date(),
  ): Promise<WelcomeCreditResult> {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      throw new Error('groupId must be a positive safe integer');
    }
    const actor = lineUserId.trim();
    if (!actor || actor.length > 64) {
      throw new Error('lineUserId must contain 1-64 characters');
    }

    const attribution = await this.repository.claimAttribution(
      groupId,
      actor,
      numberToTwdCostUnits(this.config.credits.welcomeFirstGroupCostTwd),
      numberToTwdCostUnits(this.config.credits.welcomeLaterGroupCostTwd),
      at,
    );

    if (attribution.grantOperationId !== null) {
      return {
        status: 'ALREADY_GRANTED',
        attributionId: attribution.id,
        isFirstGroup: attribution.isFirstGroup,
        amountUnits: attribution.amountUnits,
        operationId: attribution.grantOperationId,
      };
    }
    if (attribution.amountUnits === 0n) {
      return {
        status: 'NO_CREDIT_CONFIGURED',
        attributionId: attribution.id,
        isFirstGroup: attribution.isFirstGroup,
        amountUnits: 0n,
        operationId: null,
      };
    }

    const grant = await this.ledger.grant(
      groupId,
      'WELCOME',
      attribution.amountUnits,
      { type: 'WELCOME_GROUP', id: String(groupId) },
      at,
    );
    if (grant.status === 'REFERENCE_CONFLICT') {
      return {
        status: 'REFERENCE_CONFLICT',
        attributionId: attribution.id,
        isFirstGroup: attribution.isFirstGroup,
        amountUnits: attribution.amountUnits,
        operationId: grant.operationId,
      };
    }
    if (grant.status !== 'APPLIED' && grant.status !== 'ALREADY_APPLIED') {
      throw new Error(`unexpected welcome credit grant status: ${grant.status}`);
    }
    if (grant.operationId === null) {
      throw new Error('welcome credit grant requires an operation id');
    }

    const completion = await this.repository.completeAttribution(
      attribution.id,
      grant.operationId,
      at,
    );
    if (completion === 'CONFLICT') {
      return {
        status: 'PERSISTENCE_CONFLICT',
        attributionId: attribution.id,
        isFirstGroup: attribution.isFirstGroup,
        amountUnits: attribution.amountUnits,
        operationId: grant.operationId,
      };
    }

    return {
      status:
        attribution.state === 'CREATED' &&
        grant.status === 'APPLIED' &&
        completion === 'COMPLETED'
          ? 'GRANTED'
          : 'ALREADY_GRANTED',
      attributionId: attribution.id,
      isFirstGroup: attribution.isFirstGroup,
      amountUnits: attribution.amountUnits,
      operationId: grant.operationId,
    };
  }
}
