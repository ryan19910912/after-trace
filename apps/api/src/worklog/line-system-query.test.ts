import { describe, expect, it } from 'vitest';
import { WorklogLineSystemQueryService } from './line-system-query';

const grants = {
  eligibleBalance: async (ownerUserId: number, sourceId: number) => ({ ownerUserId, sourceId, totalRemainingPoints: 123456, grants: [] }),
};

describe('WorklogLineSystemQueryService', () => {
  it('answers GROUP AI responsible user and balance deterministically', async () => {
    const service = new WorklogLineSystemQueryService({
      groupState: async () => ({ responsibleUserId: 7, responsibleDisplayName: 'Ryan Hsu', responsibleLineUserId: 'U1' }),
    }, grants as never);
    await expect(service.group({ sourceId: 3, query: 'AI_RESPONSIBLE_USER' })).resolves.toContain('Ryan Hsu');
    await expect(service.group({ sourceId: 3, query: 'AI_BALANCE' })).resolves.toContain('123,456');
  });

  it('answers PRIVATE AI balance from the current user grant', async () => {
    const service = new WorklogLineSystemQueryService({ groupState: async () => null }, grants as never);
    await expect(service.personal({ userId: 7, sourceId: 9, query: 'AI_BALANCE' })).resolves.toContain('123,456');
  });
});
