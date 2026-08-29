export type ReminderCreateInput = {
  groupId: number;
  requestKey: string;
  message: string;
  scheduledFor: Date;
  reservedCostUnits: bigint;
  actorLineUserId: string;
};

export type ReminderCreateStatus =
  | 'CREATED'
  | 'ALREADY_CREATED'
  | 'INSUFFICIENT_PAID'
  | 'REFERENCE_CONFLICT'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_INACTIVE';

export type ReminderCancelStatus =
  | 'CANCELLED'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_DELIVERED'
  | 'NOT_FOUND'
  | 'REFERENCE_CONFLICT';

export type ReminderDeliveryStatus =
  | 'DELIVERED'
  | 'ALREADY_DELIVERED'
  | 'ALREADY_CANCELLED'
  | 'NOT_FOUND'
  | 'REFERENCE_CONFLICT';

export type ReminderMutationResult<TStatus extends string> = {
  status: TStatus;
  reminderId: number | null;
};

export type ReminderCreateCommand = ReminderCreateInput & { at: Date };
export type ReminderCancelCommand = {
  groupId: number;
  reminderId: number;
  actorLineUserId: string;
  at: Date;
};
export type ReminderDeliveryCommand = {
  groupId: number;
  reminderId: number;
  deliveryReference: string;
  at: Date;
};

export interface ReminderRepository {
  create(
    command: ReminderCreateCommand,
  ): Promise<ReminderMutationResult<ReminderCreateStatus>>;
  cancel(
    command: ReminderCancelCommand,
  ): Promise<ReminderMutationResult<ReminderCancelStatus>>;
  settleSuccessfulDelivery(
    command: ReminderDeliveryCommand,
  ): Promise<ReminderMutationResult<ReminderDeliveryStatus>>;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function boundedNonEmpty(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${name} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function nonEmptyMessage(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('message must not be empty');
  return normalized;
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
  return value;
}

function positiveUnits(value: bigint): bigint {
  if (value <= 0n) throw new Error('reservedCostUnits must be greater than zero');
  return value;
}

export class ReminderService {
  constructor(private readonly repository: ReminderRepository) {}

  create(
    input: ReminderCreateInput,
    at = new Date(),
  ): Promise<ReminderMutationResult<ReminderCreateStatus>> {
    return this.repository.create({
      groupId: positiveSafeInteger(input.groupId, 'groupId'),
      requestKey: boundedNonEmpty(input.requestKey, 'requestKey', 128),
      message: nonEmptyMessage(input.message),
      scheduledFor: validDate(input.scheduledFor, 'scheduledFor'),
      reservedCostUnits: positiveUnits(input.reservedCostUnits),
      actorLineUserId: boundedNonEmpty(input.actorLineUserId, 'actorLineUserId', 64),
      at: validDate(at, 'at'),
    });
  }

  cancel(
    groupId: number,
    reminderId: number,
    actorLineUserId: string,
    at = new Date(),
  ): Promise<ReminderMutationResult<ReminderCancelStatus>> {
    return this.repository.cancel({
      groupId: positiveSafeInteger(groupId, 'groupId'),
      reminderId: positiveSafeInteger(reminderId, 'reminderId'),
      actorLineUserId: boundedNonEmpty(actorLineUserId, 'actorLineUserId', 64),
      at: validDate(at, 'at'),
    });
  }

  settleSuccessfulDelivery(
    groupId: number,
    reminderId: number,
    deliveryReference: string,
    at = new Date(),
  ): Promise<ReminderMutationResult<ReminderDeliveryStatus>> {
    return this.repository.settleSuccessfulDelivery({
      groupId: positiveSafeInteger(groupId, 'groupId'),
      reminderId: positiveSafeInteger(reminderId, 'reminderId'),
      deliveryReference: boundedNonEmpty(deliveryReference, 'deliveryReference', 128),
      at: validDate(at, 'at'),
    });
  }
}
