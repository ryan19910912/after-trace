import type { CreditBucket } from './allocation';

export type CreditOperationType = 'GRANT' | 'CONSUME' | 'RESERVE' | 'RELEASE';

export type CreditReference = {
  type: string;
  id: string;
};

export type CreditLedgerMutationStatus =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'INSUFFICIENT'
  | 'NOT_FOUND'
  | 'ALREADY_SETTLED'
  | 'REFERENCE_CONFLICT';

export type CreditLedgerMutation = {
  status: CreditLedgerMutationStatus;
  operationId: number | null;
};

export interface CreditLedgerRepository {
  grant(
    groupId: number,
    bucket: CreditBucket,
    amountUnits: bigint,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation>;
  consume(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation>;
  reservePaid(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation>;
  releasePaidReservation(
    groupId: number,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation>;
  consumePaidReservation(
    groupId: number,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation>;
}

function normalizeReference(reference: CreditReference): CreditReference {
  const type = reference.type.trim().toUpperCase();
  const id = reference.id.trim();
  if (!type || type.length > 64) {
    throw new Error('credit reference type must contain 1-64 characters');
  }
  if (!id || id.length > 128) {
    throw new Error('credit reference id must contain 1-128 characters');
  }
  return { type, id };
}

function positiveUnits(units: bigint): bigint {
  if (units <= 0n) throw new Error('credit amount must be greater than zero');
  return units;
}

function positiveGroupId(groupId: number): number {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new Error('groupId must be a positive safe integer');
  }
  return groupId;
}

export class CreditLedgerService {
  constructor(private readonly repository: CreditLedgerRepository) {}

  grant(
    groupId: number,
    bucket: CreditBucket,
    amountUnits: bigint,
    reference: CreditReference,
    at = new Date(),
  ): Promise<CreditLedgerMutation> {
    return this.repository.grant(
      positiveGroupId(groupId),
      bucket,
      positiveUnits(amountUnits),
      normalizeReference(reference),
      at,
    );
  }

  consume(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at = new Date(),
  ): Promise<CreditLedgerMutation> {
    return this.repository.consume(
      positiveGroupId(groupId),
      positiveUnits(amountUnits),
      normalizeReference(reference),
      at,
    );
  }

  reservePaid(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at = new Date(),
  ): Promise<CreditLedgerMutation> {
    return this.repository.reservePaid(
      positiveGroupId(groupId),
      positiveUnits(amountUnits),
      normalizeReference(reference),
      at,
    );
  }

  releasePaidReservation(
    groupId: number,
    reference: CreditReference,
    at = new Date(),
  ): Promise<CreditLedgerMutation> {
    return this.repository.releasePaidReservation(
      positiveGroupId(groupId),
      normalizeReference(reference),
      at,
    );
  }

  consumePaidReservation(
    groupId: number,
    reference: CreditReference,
    at = new Date(),
  ): Promise<CreditLedgerMutation> {
    return this.repository.consumePaidReservation(
      positiveGroupId(groupId),
      normalizeReference(reference),
      at,
    );
  }
}
