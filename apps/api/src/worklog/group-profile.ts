import type { LineGroupSummaryResult } from '../line/group-summary';

export const WORKLOG_GROUP_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

export type WorklogCachedGroupProfile = {
  sourceId: number;
  lineGroupId: string;
  groupName: string | null;
  pictureUrl: string | null;
  syncedAt: Date | null;
};

export interface WorklogGroupProfileRepository {
  findByLineGroupId(lineGroupId: string): Promise<WorklogCachedGroupProfile | null>;
  save(input: {
    sourceId: number;
    groupName: string;
    pictureUrl: string | null;
    syncedAt: Date;
  }): Promise<void>;
}

export interface WorklogLineGroupSummaryPort {
  getGroupSummary(lineGroupId: string): Promise<LineGroupSummaryResult>;
}

export type WorklogGroupProfileRefreshResult =
  | { status: 'SOURCE_NOT_FOUND' }
  | { status: 'FRESH'; profile: WorklogCachedGroupProfile }
  | { status: 'REFRESHED'; profile: WorklogCachedGroupProfile }
  | { status: 'LINE_GROUP_NOT_FOUND'; profile: WorklogCachedGroupProfile };

/**
 * Lazy refresh only. No cron/scheduled work should call this merely because time passed.
 * A caller invokes it when a real user operation needs the GROUP Source/profile.
 */
export class WorklogGroupProfileService {
  constructor(
    private readonly repository: WorklogGroupProfileRepository,
    private readonly line: WorklogLineGroupSummaryPort,
    private readonly ttlMs = WORKLOG_GROUP_PROFILE_TTL_MS,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('group profile TTL must be positive');
  }

  async refreshIfStale(input: {
    lineGroupId: string;
    at?: Date;
  }): Promise<WorklogGroupProfileRefreshResult> {
    const lineGroupId = normalizeLineGroupId(input.lineGroupId);
    const at = validDate(input.at ?? new Date());
    const cached = await this.repository.findByLineGroupId(lineGroupId);
    if (!cached) return { status: 'SOURCE_NOT_FOUND' };

    if (cached.syncedAt && at.getTime() - cached.syncedAt.getTime() < this.ttlMs) {
      return { status: 'FRESH', profile: cached };
    }

    const summary = await this.line.getGroupSummary(lineGroupId);
    if (summary.status === 'NOT_FOUND') {
      // A live incoming group webhook is stronger evidence that this invocation still
      // belongs to the group. Do not revoke Source access from this presentation refresh.
      // PWA authorization/lifecycle state remains authoritative for access control.
      return { status: 'LINE_GROUP_NOT_FOUND', profile: cached };
    }

    await this.repository.save({
      sourceId: cached.sourceId,
      groupName: summary.groupName,
      pictureUrl: summary.pictureUrl,
      syncedAt: at,
    });
    return {
      status: 'REFRESHED',
      profile: {
        ...cached,
        groupName: summary.groupName,
        pictureUrl: summary.pictureUrl,
        syncedAt: at,
      },
    };
  }
}

function normalizeLineGroupId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('LINE group id is required');
  if (normalized.length > 64) throw new Error('LINE group id is too long');
  return normalized;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('group profile reference time must be valid');
  return new Date(value.getTime());
}
