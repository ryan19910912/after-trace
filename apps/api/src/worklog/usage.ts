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
  periodStart: Date | null;
  periodEnd: Date | null;
};

export type UserUsageSummary = {
  userId: number;
  planCode: string;
  aiAllowanceUnits: number;
  aiUsedUnits: number;
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

export class WorklogUsageService {
  constructor(private readonly repository: WorklogUsageRepository) {}

  async userUsage(userId: number): Promise<UserUsageSummary> {
    const window = await this.repository.getActiveUsageWindow(userId);
    const [ai, records] = await Promise.all([
      this.repository.sumChargedAiUsage(
        userId,
        window?.periodStart ?? null,
        window?.periodEnd ?? null,
      ),
      this.repository.countRecordsByAuthor(userId),
    ]);
    return makeUserSummary(userId, window, ai, records);
  }

  async groupOwnerUsage(
    viewerUserId: number,
    sourceId: number,
  ): Promise<{ status: 'OK'; value: GroupOwnerUsageView } | { status: 'FORBIDDEN' | 'OWNER_UNBOUND' }> {
    const ownerUserId = await this.repository.getGroupOwnerUserId(sourceId);
    if (ownerUserId === null) return { status: 'OWNER_UNBOUND' };
    if (ownerUserId !== viewerUserId) return { status: 'FORBIDDEN' };

    const window = await this.repository.getActiveUsageWindow(ownerUserId);
    const [ownerAi, ownerRecords, groupAi, members] = await Promise.all([
      this.repository.sumChargedAiUsage(
        ownerUserId,
        window?.periodStart ?? null,
        window?.periodEnd ?? null,
      ),
      this.repository.countRecordsByAuthor(ownerUserId),
      this.repository.sumChargedAiUsage(
        ownerUserId,
        window?.periodStart ?? null,
        window?.periodEnd ?? null,
        sourceId,
      ),
      this.repository.listGroupMemberUsage(
        sourceId,
        window?.periodStart ?? null,
        window?.periodEnd ?? null,
      ),
    ]);

    return {
      status: 'OK',
      value: {
        sourceId,
        ownerUserId,
        owner: makeUserSummary(ownerUserId, window, ownerAi, ownerRecords),
        groupAiUsedUnits: integer(groupAi.aiUnits),
        groupProviderCostUsd: finite(groupAi.providerCostUsd),
        groupProviderCostTwd: finite(groupAi.providerCostTwd),
        members,
      },
    };
  }
}

export function emptyRecordTypeCounts(): RecordTypeCounts {
  return { TEXT: 0, AUDIO: 0, IMAGE: 0, FILE: 0 };
}

function makeUserSummary(
  userId: number,
  window: ActiveUsageWindow | null,
  ai: AiUsageAggregate,
  records: RecordTypeCounts,
): UserUsageSummary {
  const allowance = integer(window?.allowanceUnits ?? 0);
  const used = integer(ai.aiUnits);
  return {
    userId,
    planCode: window?.planCode ?? 'FREE',
    aiAllowanceUnits: allowance,
    aiUsedUnits: used,
    aiRemainingUnits: remainingAiAllowance(allowance, used),
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
