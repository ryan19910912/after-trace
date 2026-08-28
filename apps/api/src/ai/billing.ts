import { parseTwdCostUnits } from '../credits/allocation';
import type {
  CreditLedgerMutation,
  CreditReference,
} from '../credits/ledger';
import type { AiUsageRepository, BillableAiUsage } from './usage';

export type UnchargedAiUsage = Omit<BillableAiUsage, 'chargeOperationId'>;

export interface AiBillingCreditPort {
  consume(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at?: Date,
  ): Promise<CreditLedgerMutation>;
}

export type AiBillingResult =
  | { status: 'BILLED'; operationId: number; usageRecord: 'RECORDED' | 'ALREADY_RECORDED' }
  | { status: 'INSUFFICIENT_CREDIT' }
  | { status: 'CREDIT_REFERENCE_CONFLICT' };

export class AiBillingService {
  constructor(
    private readonly credits: AiBillingCreditPort,
    private readonly usageRepository: AiUsageRepository,
  ) {}

  async chargeAndRecord(
    usage: UnchargedAiUsage,
    reference: CreditReference,
  ): Promise<AiBillingResult> {
    const charge = await this.credits.consume(
      usage.groupId,
      parseTwdCostUnits(usage.chargedCostTwd),
      reference,
      usage.createdAt,
    );

    if (charge.status === 'INSUFFICIENT') {
      return { status: 'INSUFFICIENT_CREDIT' };
    }
    if (charge.status === 'REFERENCE_CONFLICT') {
      return { status: 'CREDIT_REFERENCE_CONFLICT' };
    }
    if (charge.status !== 'APPLIED' && charge.status !== 'ALREADY_APPLIED') {
      throw new Error(`unexpected credit status for AI usage: ${charge.status}`);
    }
    if (charge.operationId === null) {
      throw new Error('credit operation id is required before AI usage persistence');
    }

    const usageRecord = await this.usageRepository.record({
      ...usage,
      chargeOperationId: charge.operationId,
    });

    return {
      status: 'BILLED',
      operationId: charge.operationId,
      usageRecord,
    };
  }
}
