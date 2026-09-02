import { remainingAiAllowance } from './entitlements';

export type RecordTypeCounts = {
  TEXT: number;
  AUDIO: number;
  IMAGE: number;
  FILE: number;
};

export type AiUsageAggregate = {
  aiUnits: number;
  providerCostUsd: number;
  providerCostTwd: number;
};

export type ActiveUsageWindow = {
  planCode: string;
  allowanceUnits: number;
  reservedUnits: number;
  periodStart: Date | null;
  periodEnd: Date | null;
};

export type UserUsageSummary = {
  userId: number;
  planCode: string;
  aiAllowanceUnits: number;
  aiUsedUnits: number;
  aiReservedUnits: number;
  aiRemainingUnits: number;
  providerCostUsd: number;
  providerCostTwd: number;
  records: RecordTypeCounts;
};

export type GroupMemberUsage = {
  userId: number;
  displayName: string | null;
  recordingEnabled: boolean;
  aiUsedUnits: number;
  providerCostUsd: number;
  providerCostTwd: number;
  records: RecordTypeCounts;
  lastInteractionAt: string | null;
  updatedAt: string;
};

export type GroupOwnerUsageView = {
  sourceId: number;
  ownerUserId: number;
  owner: UserUsageSummary;
  groupAiUsedUnits: number;
  groupProviderCostUsd: number;
  groupProviderCostTwd: number;
  members: GroupMemberUsage[];
};

export interface WorklogUsageRepository {
  getActiveUsageWindow(userId: number): Promise<ActiveUsageWindow | null>;
  sumChargedAiUsage(
    chargedUserId: number,
    periodStart: Date | null,
    periodEnd: Date | null,
    sourceId?: number,
  ): Promise<AiUsageAggregate>;
  countRecordsByAuthor(userId: number, sourceId?: number): Promise<RecordTypeCounts>;
  getGroupOwnerUserId(sourceId: number): Promise<number | null>;
  listGroupMemberUsage(
    sourceId: number,
    periodStart: Date | null,
    periodEnd: Date | null,
  ): Promise<GroupMemberUsage[]>;
}

export type GroupOwnerUsageResult =
  | { status: 'OK'; value: GroupOwnerUsageView }
  | { status: 'FORBIDDEN' }
  | { status: 'OWNER_UNBOUND' };

const ZERO_AI: AiUsageAggregate = { aiUnits: 0, providerCostUsd: 0, providerCostTwd: 0 };

export class WorklogUsageService {
  constructor(private readonly repository: WorklogUsageRepository) {}

  async userUsage(userId: number): Promise<UserUsageSummary> {
    const window = await this.repository.getActiveUsageWindow(userId);
    const [ai, records] = await Promise.all([
      window
        ? this.repository.sumChargedAiUsage(userId, window.periodStart, window.periodEnd)
        : Promise.resolve(ZERO_AI),
      this.repository.countRecordsByAuthor(userId),
    ]);
    return makeUserSummary(userId, window, ai, records);
  }

  async groupOwnerUsage(
    viewerUserId: number,
    sourceId: number,
  ): Promise<GroupOwnerUsageResult> {
    const ownerUserId = await this.repository.getGroupOwnerUserId(sourceId);
    if (ownerUserId === null) return { status: 'OWNER_UNBOUND' };
    if (ownerUserId !== viewerUserId) return { status: 'FORBIDDEN' };

    const window = await this.repository.getActiveUsageWindow(ownerUserId);
    const [ownerAi, ownerRecords, groupAi, members] = await Promise.all([
      window
        ? this.repository.sumChargedAiUsage(ownerUserId, window.periodStart, window.periodEnd)
        : Promise.resolve(ZERO_AI),
      this.repository.countRecordsByAuthor(ownerUserId),
      window
        ? this.repository.sumChargedAiUsage(ownerUserId, window.periodStart, window.periodEnd, sourceId)
        : Promise.resolve(ZERO_AI),
      this.repository.listGroupMemberUsage(
        sourceId,
        window?.periodStart ?? null,
        window?.periodEnd ?? null,
      ),
    ]);

    const cycleMembers = window ? members : members.map(withoutAiUsage);
    return {
      status: 'OK',
      value: {
        sourceId,
        ownerUserId,
        owner: makeUserSummary(ownerUserId, window, ownerAi, ownerRecords),
        groupAiUsedUnits: integer(groupAi.aiUnits),
        groupProviderCostUsd: finite(groupAi.providerCostUsd),
        groupProviderCostTwd: finite(groupAi.providerCostTwd),
        members: cycleMembers,
      },
    };
  }
}

export function emptyRecordTypeCounts(): RecordTypeCounts {
  return { TEXT: 0, AUDIO: 0, IMAGE: 0, FILE: 0 };
}

function withoutAiUsage(member: GroupMemberUsage): GroupMemberUsage {
  return {
    ...member,
    aiUsedUnits: 0,
    providerCostUsd: 0,
    providerCostTwd: 0,
  };
}

function makeUserSummary(
  userId: number,
  window: ActiveUsageWindow | null,
  ai: AiUsageAggregate,
  records: RecordTypeCounts,
): UserUsageSummary {
  const allowance = integer(window?.allowanceUnits ?? 0);
  const used = integer(ai.aiUnits);
  const reserved = integer(window?.reservedUnits ?? 0);
  return {
    userId,
    planCode: window?.planCode ?? 'FREE',
    aiAllowanceUnits: allowance,
    aiUsedUnits: used,
    aiReservedUnits: reserved,
    aiRemainingUnits: remainingAiAllowance(allowance, used + reserved),
    providerCostUsd: finite(ai.providerCostUsd),
    providerCostTwd: finite(ai.providerCostTwd),
    records: {
      TEXT: integer(records.TEXT),
      AUDIO: integer(records.AUDIO),
      IMAGE: integer(records.IMAGE),
      FILE: integer(records.FILE),
    },
  };
}

function integer(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
