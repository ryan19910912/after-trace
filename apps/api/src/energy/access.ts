import { formatGroupEnergyStatus, type GroupEnergyMemberStatus } from '../line/energy-status';

export type CallerEnergySnapshot = {
  userId: number;
  usableUnits: bigint;
};

export interface UserEnergyAccessRepository {
  findCaller(lineUserId: string, at: Date): Promise<CallerEnergySnapshot | null>;
  listGroupMemberAvailability(
    groupId: number,
    callerLineUserId: string,
    at: Date,
  ): Promise<GroupEnergyMemberStatus[]>;
}

export type AiFundingPreflight =
  | { status: 'READY'; userId: number; usableUnits: bigint }
  | { status: 'EXHAUSTED'; reply: string }
  | { status: 'CALLER_NOT_FOUND'; reply: string };

export class UserEnergyAccessService {
  constructor(
    private readonly repository: UserEnergyAccessRepository,
    private readonly liffAppUrl: string,
  ) {}

  async preflightExplicitAi(input: {
    groupId: number;
    callerLineUserId: string;
    at: Date;
  }): Promise<AiFundingPreflight> {
    const caller = await this.repository.findCaller(input.callerLineUserId, input.at);
    if (caller && caller.usableUnits > 0n) {
      return { status: 'READY', userId: caller.userId, usableUnits: caller.usableUnits };
    }

    const members = await this.repository.listGroupMemberAvailability(
      input.groupId,
      input.callerLineUserId,
      input.at,
    );
    const reply = formatGroupEnergyStatus(members, this.liffAppUrl, true);
    return caller ? { status: 'EXHAUSTED', reply } : { status: 'CALLER_NOT_FOUND', reply };
  }

  async energyStatus(input: {
    groupId: number;
    callerLineUserId: string;
    at: Date;
  }): Promise<string> {
    const members = await this.repository.listGroupMemberAvailability(
      input.groupId,
      input.callerLineUserId,
      input.at,
    );
    return formatGroupEnergyStatus(members, this.liffAppUrl, false);
  }
}
