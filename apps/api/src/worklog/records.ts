export type WorklogRecordListItem = {
  id: number;
  sourceId: number;
  title: string | null;
  authorUserId: number | null;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  rawText: string;
  occurredAt: string | null;
  status: 'ACTIVE' | 'DELETED';
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorklogGroupSurface = {
  sourceId: number;
  name: string;
  role: 'OWNER' | 'MEMBER';
};

export type WorklogPwaSurfaces = {
  personal: { sourceId: number } | null;
  groups: WorklogGroupSurface[];
};

export interface WorklogRecordReadRepository {
  getActivePersonalSourceId(userId: number): Promise<number | null>;
  listActiveGroupSurfaces(userId: number): Promise<WorklogGroupSurface[]>;
  isActiveGroupMember(userId: number, sourceId: number): Promise<boolean>;
  listRecordsBySource(sourceId: number, limit: number): Promise<WorklogRecordListItem[]>;
}

export class WorklogRecordReadService {
  constructor(private readonly repository: WorklogRecordReadRepository) {}

  async surfaces(userId: number): Promise<WorklogPwaSurfaces> {
    const [personalSourceId, groups] = await Promise.all([
      this.repository.getActivePersonalSourceId(userId),
      this.repository.listActiveGroupSurfaces(userId),
    ]);
    return {
      personal: personalSourceId === null ? null : { sourceId: personalSourceId },
      groups,
    };
  }

  async personalRecords(userId: number, limit = 100): Promise<WorklogRecordListItem[]> {
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
