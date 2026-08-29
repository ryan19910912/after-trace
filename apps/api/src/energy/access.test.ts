import { describe, expect, it } from 'vitest';
import { UserEnergyAccessService, type UserEnergyAccessRepository } from './access';

class FakeAccessRepository implements UserEnergyAccessRepository {
  caller: { userId: number; usableUnits: bigint } | null = null;

  async findCaller() {
    return this.caller;
  }

  async listGroupMemberAvailability() {
    return [
      { displayName: '你', usable: (this.caller?.usableUnits ?? 0n) > 0n },
      { displayName: '成員 2', usable: true },
    ];
  }
}

describe('UserEnergyAccessService', () => {
  it('allows AI only from caller own positive balance', async () => {
    const repository = new FakeAccessRepository();
    repository.caller = { userId: 77, usableUnits: 12n };
    const service = new UserEnergyAccessService(repository, 'https://liff.line.me/test');

    await expect(service.preflightExplicitAi({
      groupId: 1,
      callerLineUserId: 'caller',
      at: new Date(),
    })).resolves.toEqual({ status: 'READY', userId: 77, usableUnits: 12n });
  });

  it('does not borrow another member balance when caller is exhausted', async () => {
    const repository = new FakeAccessRepository();
    repository.caller = { userId: 77, usableUnits: 0n };
    const service = new UserEnergyAccessService(repository, 'https://liff.line.me/test');

    const result = await service.preflightExplicitAi({
      groupId: 1,
      callerLineUserId: 'caller',
      at: new Date(),
    });

    expect(result.status).toBe('EXHAUSTED');
    if (result.status !== 'EXHAUSTED') throw new Error('expected exhausted');
    expect(result.reply).toContain('你的 AFTERTRACE Energy 已用完');
    expect(result.reply).toContain('成員 2　可使用');
    expect(result.reply).not.toContain('12');
  });

  it('energy status is deterministic and contains no private numeric balances', async () => {
    const repository = new FakeAccessRepository();
    repository.caller = { userId: 77, usableUnits: 999n };
    const service = new UserEnergyAccessService(repository, 'https://liff.line.me/test');

    const reply = await service.energyStatus({
      groupId: 1,
      callerLineUserId: 'caller',
      at: new Date(),
    });
    expect(reply).toContain('AFTERTRACE｜群組 Energy');
    expect(reply).not.toContain('999');
  });
});
