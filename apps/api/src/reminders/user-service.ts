export type UserReminderCreateStatus =
  | 'CREATED'
  | 'ALREADY_CREATED'
  | 'INSUFFICIENT_PROACTIVE_ENERGY'
  | 'REFERENCE_CONFLICT'
  | 'OWNER_NOT_FOUND'
  | 'OWNER_NOT_GROUP_MEMBER'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_INACTIVE';

export type UserReminderCancelStatus =
  | 'CANCELLED'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_DELIVERED'
  | 'NOT_FOUND'
  | 'NOT_OWNER'
  | 'REFERENCE_CONFLICT';

export type UserReminderMutationResult<TStatus extends string> = {
  status: TStatus;
  reminderId: number | null;
};

export interface UserReminderRepository {
  create(input: {
    groupId: number;
    ownerLineUserId: string;
    requestKey: string;
    message: string;
    scheduledFor: Date;
    reservationUnits: bigint;
    at: Date;
  }): Promise<UserReminderMutationResult<UserReminderCreateStatus>>;
  cancel(input: {
    groupId: number;
    reminderId: number;
    ownerLineUserId: string;
    mutationKey: string;
    at: Date;
  }): Promise<UserReminderMutationResult<UserReminderCancelStatus>>;
}

export class UserReminderService {
  constructor(private readonly repository: UserReminderRepository) {}

  create(input: {
    groupId: number;
    ownerLineUserId: string;
    requestKey: string;
    message: string;
    scheduledFor: Date;
    reservationUnits: bigint;
  }, at = new Date()): Promise<UserReminderMutationResult<UserReminderCreateStatus>> {
    assertPositiveId(input.groupId, 'groupId');
    const ownerLineUserId = bounded(input.ownerLineUserId, 'ownerLineUserId', 64);
    const requestKey = bounded(input.requestKey, 'requestKey', 128);
    const message = input.message.trim();
    if (!message) throw new Error('message is required');
    if (!(input.scheduledFor instanceof Date) || Number.isNaN(input.scheduledFor.getTime())) {
      throw new Error('scheduledFor must be a valid Date');
    }
    if (input.scheduledFor.getTime() <= at.getTime()) {
      throw new Error('scheduledFor must be in the future');
    }
    if (input.reservationUnits <= 0n) throw new Error('reservationUnits must be positive');
    return this.repository.create({
      groupId: input.groupId,
      ownerLineUserId,
      requestKey,
      message,
      scheduledFor: input.scheduledFor,
      reservationUnits: input.reservationUnits,
      at,
    });
  }

  cancel(input: {
    groupId: number;
    reminderId: number;
    ownerLineUserId: string;
    mutationKey: string;
  }, at = new Date()): Promise<UserReminderMutationResult<UserReminderCancelStatus>> {
    assertPositiveId(input.groupId, 'groupId');
    assertPositiveId(input.reminderId, 'reminderId');
    return this.repository.cancel({
      groupId: input.groupId,
      reminderId: input.reminderId,
      ownerLineUserId: bounded(input.ownerLineUserId, 'ownerLineUserId', 64),
      mutationKey: bounded(input.mutationKey, 'mutationKey', 128),
      at,
    });
  }
}

function assertPositiveId(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}

function bounded(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${name} must contain 1-${max} characters`);
  return normalized;
}
