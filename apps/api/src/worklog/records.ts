export type WorklogRecordListItem = {
  id: number;
  sourceId: number;
  authorUserId: number | null;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  category: string;
  rawText: string | null;
  normalizedSummary: string | null;
  customerId: number | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WorklogGroupSurface = {
  sourceId: number;
  lineGroupId: string;
};

export type WorklogPwaSurfaces = {
  personal: { sourceId: number } | null;
  groups: WorklogGroupSurface[];
};

export interface WorklogRecordReadRepository {
  isOaFriend(userId: number): Promise<boolean>;
  getActivePersonalSourceId(userId: number): Promise<number | null>;
  listActiveGroupSurfaces(userId: number): Promise<WorklogGroupSurface[]>;
  isActiveGroupMember(userId: number, sourceId: number): Promise<boolean>;
  listRecordsBySource(sourceId: number, limit: number): Promise<WorklogRecordListItem[]>;
}

export class WorklogRecordReadService {
  constructor(private readonly repository: WorklogRecordReadRepository) {}

  async surfaces(userId: number): Promise<WorklogPwaSurfaces> {
    const [oaFriend, groups] = await Promise.all([
      this.repository.isOaFriend(userId),
      this.repository.listActiveGroupSurfaces(userId),
    ]);
    const personalSourceId = oaFriend
      ? await this.repository.getActivePersonalSourceId(userId)
      : null;
    return {
      personal: personalSourceId === null ? null : { sourceId: personalSourceId },
      groups,
    };
  }

  async personalRecords(userId: number, limit = 100): Promise<WorklogRecordListItem[]> {
    if (!(await this.repository.isOaFriend(userId))) return [];
    const sourceId = await this.repository.getActivePersonalSourceId(userId);
    if (sourceId === null) return [];
    return this.repository.listRecordsBySource(sourceId, safeLimit(limit));
  }

  async groupRecords(
    userId: number,
    sourceId: number,
    limit = 100,
  ): Promise<{ status: 'OK'; records: WorklogRecordListItem[] } | { status: 'FORBIDDEN' }> {
    if (!(await this.repository.isActiveGroupMember(userId, sourceId))) {
      return { status: 'FORBIDDEN' };
    }
    return {
      status: 'OK',
      records: await this.repository.listRecordsBySource(sourceId, safeLimit(limit)),
    };
  }
}

function safeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(200, Math.floor(value)));
}
