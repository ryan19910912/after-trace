import { describe, expect, it } from 'vitest';
import {
  WorklogLineSystemQueryService,
  type WorklogGroupSystemState,
  type WorklogLineSystemQueryRepository,
} from './line-system-query';

class FakeRepository implements WorklogLineSystemQueryRepository {
  group: WorklogGroupSystemState = {
    responsibleUserId: 7,
    responsibleDisplayName: 'Ryan Hsu',
    responsibleLineUserId: 'U1',
  };
  displayName: string | null = 'Ryan Hsu';
  allowanceValue = { totalPoints: 400_000, remainingPoints: 320_000 };

  async groupState() { return this.group; }
  async userDisplayName() { return this.displayName; }
  async allowance() { return this.allowanceValue; }
}

describe('WorklogLineSystemQueryService status', () => {
  it('shows responsible user, remaining/total points and current utilization for GROUP', async () => {
    const repository = new FakeRepository();
    const text = await new WorklogLineSystemQueryService(repository).groupStatus({ sourceId: 20, at: new Date('2026-09-06T12:00:00Z') });
    expect(text).toContain('AFTERTRACE 群組狀態');
    expect(text).toContain('AI 負責人：@Ryan Hsu');
    expect(text).toContain('AI 點數：320,000 / 400,000');
    expect(text).toContain('目前額度使用率：20%');
    expect(text).toContain('AI 功能：可使用');
  });

  it('works without AI responsibility or provider availability', async () => {
    const repository = new FakeRepository();
    repository.group = { responsibleUserId: null, responsibleDisplayName: null, responsibleLineUserId: null };
    const text = await new WorklogLineSystemQueryService(repository).groupStatus({ sourceId: 20 });
    expect(text).toContain('AI 負責人：尚未設定');
    expect(text).toContain('AI 功能：暫停');
    expect(text).toContain('小跡 啟用 AI');
  });

  it('shows personal allowance with cached LINE display name', async () => {
    const repository = new FakeRepository();
    repository.allowanceValue = { totalPoints: 400_000, remainingPoints: 0 };
    const text = await new WorklogLineSystemQueryService(repository).personalStatus({ userId: 7, sourceId: 9 });
    expect(text).toContain('AFTERTRACE 個人狀態');
    expect(text).toContain('AI 負責人：@Ryan Hsu');
    expect(text).toContain('AI 點數：0 / 400,000');
    expect(text).toContain('目前額度使用率：100%');
    expect(text).toContain('AI 功能：目前無可用點數');
  });

  it('falls back to internal user id when LINE display name is unavailable', async () => {
    const repository = new FakeRepository();
    repository.displayName = null;
    const text = await new WorklogLineSystemQueryService(repository).personalStatus({ userId: 7, sourceId: 9 });
    expect(text).toContain('AI 負責人：使用者 #7');
  });
});
