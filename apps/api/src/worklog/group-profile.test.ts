import { describe, expect, it } from 'vitest';
import {
  WorklogGroupProfileService,
  WORKLOG_GROUP_PROFILE_TTL_MS,
  type WorklogCachedGroupProfile,
  type WorklogGroupProfileRepository,
} from './group-profile';

class FakeRepository implements WorklogGroupProfileRepository {
  profile: WorklogCachedGroupProfile | null = null;
  saves: Array<{ sourceId: number; groupName: string; pictureUrl: string | null; syncedAt: Date }> = [];

  async findByLineGroupId(lineGroupId: string): Promise<WorklogCachedGroupProfile | null> {
    return this.profile?.lineGroupId === lineGroupId ? this.profile : null;
  }

  async save(input: { sourceId: number; groupName: string; pictureUrl: string | null; syncedAt: Date }): Promise<void> {
    this.saves.push(input);
  }
}

class FakeLine {
  calls: string[] = [];
  result:
    | { status: 'OK'; groupId: string; groupName: string; pictureUrl: string | null }
    | { status: 'NOT_FOUND' } = {
      status: 'OK',
      groupId: 'C-group-1',
      groupName: '晴空案-水電群',
      pictureUrl: null,
    };

  async getGroupSummary(lineGroupId: string) {
    this.calls.push(lineGroupId);
    return this.result;
  }
}

describe('WorklogGroupProfileService', () => {
  it('does nothing when the GROUP Source does not exist yet', async () => {
    const repo = new FakeRepository();
    const line = new FakeLine();
    const service = new WorklogGroupProfileService(repo, line);

    await expect(service.refreshIfStale({ lineGroupId: 'C-group-1' })).resolves.toEqual({ status: 'SOURCE_NOT_FOUND' });
    expect(line.calls).toHaveLength(0);
    expect(repo.saves).toHaveLength(0);
  });

  it('uses cached LINE metadata within 24 hours without calling LINE', async () => {
    const repo = new FakeRepository();
    const line = new FakeLine();
    const at = new Date('2026-09-06T10:00:00Z');
    repo.profile = {
      sourceId: 20,
      lineGroupId: 'C-group-1',
      groupName: '晴空案-水電群',
      pictureUrl: null,
      syncedAt: new Date(at.getTime() - WORKLOG_GROUP_PROFILE_TTL_MS + 1),
    };
    const service = new WorklogGroupProfileService(repo, line);

    const result = await service.refreshIfStale({ lineGroupId: 'C-group-1', at });
    expect(result.status).toBe('FRESH');
    expect(line.calls).toHaveLength(0);
    expect(repo.saves).toHaveLength(0);
  });

  it('refreshes from LINE when cached metadata is at least 24 hours old', async () => {
    const repo = new FakeRepository();
    const line = new FakeLine();
    const at = new Date('2026-09-06T10:00:00Z');
    repo.profile = {
      sourceId: 20,
      lineGroupId: 'C-group-1',
      groupName: '舊名稱',
      pictureUrl: 'https://example.test/old.png',
      syncedAt: new Date(at.getTime() - WORKLOG_GROUP_PROFILE_TTL_MS),
    };
    line.result = {
      status: 'OK',
      groupId: 'C-group-1',
      groupName: '晴空案-水電群',
      pictureUrl: 'https://example.test/new.png',
    };
    const service = new WorklogGroupProfileService(repo, line);

    await expect(service.refreshIfStale({ lineGroupId: 'C-group-1', at })).resolves.toMatchObject({
      status: 'REFRESHED',
      profile: {
        sourceId: 20,
        groupName: '晴空案-水電群',
        pictureUrl: 'https://example.test/new.png',
      },
    });
    expect(line.calls).toEqual(['C-group-1']);
    expect(repo.saves).toEqual([{
      sourceId: 20,
      groupName: '晴空案-水電群',
      pictureUrl: 'https://example.test/new.png',
      syncedAt: at,
    }]);
  });

  it('does not rewrite access state or cached metadata when LINE returns 404 during a live group command', async () => {
    const repo = new FakeRepository();
    const line = new FakeLine();
    repo.profile = {
      sourceId: 20,
      lineGroupId: 'C-group-1',
      groupName: '晴空案-水電群',
      pictureUrl: null,
      syncedAt: null,
    };
    line.result = { status: 'NOT_FOUND' };
    const service = new WorklogGroupProfileService(repo, line);

    await expect(service.refreshIfStale({ lineGroupId: 'C-group-1' })).resolves.toMatchObject({
      status: 'LINE_GROUP_NOT_FOUND',
      profile: { sourceId: 20, groupName: '晴空案-水電群' },
    });
    expect(repo.saves).toHaveLength(0);
  });
});
