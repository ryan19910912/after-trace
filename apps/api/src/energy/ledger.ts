import type { EnergyBucket } from './model';

export type EnergyReference = {
  type: string;
  id: string;
};

export type EnergyMutationStatus =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'REFERENCE_CONFLICT'
  | 'USER_NOT_FOUND'
  | 'INSUFFICIENT_ENERGY'
  | 'RESERVATION_NOT_FOUND'
  | 'RESERVATION_STATE_CONFLICT';

export type EnergyMutationResult = {
  status: EnergyMutationStatus;
  operationId: number | null;
  reservationId?: number | null;
};

export type EnergyConsumeRequest = {
  userId: number;
  units: bigint;
  at: Date;
  reference: EnergyReference;
  metadata?: Record<string, unknown>;
};

export type EnergyReserveRequest = {
  userId: number;
  units: bigint;
  at: Date;
  validThrough: Date;
  reference: EnergyReference;
  allowedBuckets?: readonly Extract<EnergyBucket, 'SUBSCRIPTION' | 'PAID'>[];
  metadata?: Record<string, unknown>;
};

export type EnergyReservationMutationRequest = {
  userId: number;
  at: Date;
  reference: EnergyReference;
  mutationReference: EnergyReference;
  metadata?: Record<string, unknown>;
};

export interface UserEnergyMutationRepository {
  consume(request: EnergyConsumeRequest): Promise<EnergyMutationResult>;
  reserve(request: EnergyReserveRequest): Promise<EnergyMutationResult>;
  releaseReservation(request: EnergyReservationMutationRequest): Promise<EnergyMutationResult>;
  consumeReservation(request: EnergyReservationMutationRequest): Promise<EnergyMutationResult>;
}

function positive(units: bigint): bigint {
  if (units <= 0n) throw new Error('Energy units must be positive');
  return units;
}

function reference(value: EnergyReference): EnergyReference {
  const type = value.type.trim();
  const id = value.id.trim();
  if (!type || !id) throw new Error('Energy reference type/id are required');
  return { type, id };
}

export class UserEnergyLedgerService {
  constructor(private readonly repository: UserEnergyMutationRepository) {}

  consume(request: EnergyConsumeRequest): Promise<EnergyMutationResult> {
    return this.repository.consume({
      ...request,
      units: positive(request.units),
      reference: reference(request.reference),
    });
  }

  reserve(request: EnergyReserveRequest): Promise<EnergyMutationResult> {
    if (request.validThrough.getTime() < request.at.getTime()) {
      throw new Error('Energy reservation validThrough must not be before at');
    }
    const allowedBuckets = request.allowedBuckets ?? ['SUBSCRIPTION', 'PAID'];
    if (allowedBuckets.length === 0) throw new Error('Energy reservation requires an allowed bucket');
    if (allowedBuckets.some((bucket) => bucket !== 'SUBSCRIPTION' && bucket !== 'PAID')) {
      throw new Error('Energy reservation only supports SUBSCRIPTION/PAID');
    }
    return this.repository.reserve({
      ...request,
      units: positive(request.units),
      reference: reference(request.reference),
      allowedBuckets,
    });
  }

  releaseReservation(request: EnergyReservationMutationRequest): Promise<EnergyMutationResult> {
    return this.repository.releaseReservation({
      ...request,
      reference: reference(request.reference),
      mutationReference: reference(request.mutationReference),
    });
  }

  consumeReservation(request: EnergyReservationMutationRequest): Promise<EnergyMutationResult> {
    return this.repository.consumeReservation({
      ...request,
      reference: reference(request.reference),
      mutationReference: reference(request.mutationReference),
    });
  }
}
