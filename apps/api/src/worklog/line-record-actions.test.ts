import { describe, expect, it } from 'vitest';
import { WorklogLineRecordActionService, type WorklogLineActionTarget, type WorklogLineRecordActionRepository } from './line-record-actions';

const target: WorklogLineActionTarget = { id: 9, sourceId: 3, entityId: 5, rawText: '晴空案收款 3000', occurredAt: '2026-09-06T00:00:00.000Z', status: 'ACTIVE', version: 2 };

class FakeRepository implements WorklogLineRecordActionRepository {
  calls: string[] = [];
  async resolveTarget() { return { status: 'FOUND' as const, record: target }; }
  async deleteRecord() { this.calls.push('DELETE'); return { status: 'DELETED' as const, recordId: 9, recordVersion: 3 }; }
  async restoreRecord() { this.calls.push('RESTORE'); return { status: 'RESTORED' as const, recordId: 9, recordVersion: 3 }; }
  async moveRecord(_target: WorklogLineActionTarget, _actor: number, title: string) { this.calls.push(`MOVE:${title}`); return { status: 'MOVED' as const, recordId: 9, recordVersion: 3 }; }
}

describe('WorklogLineRecordActionService', () => {
  it('keeps delete restore move as deterministic exact-target backend actions', async () => {
    const repository = new FakeRepository();
    const service = new WorklogLineRecordActionService(repository);
    await expect(service.delete(target, 7)).resolves.toMatchObject({ status: 'DELETED' });
    await expect(service.restore({ ...target, status: 'DELETED' }, 7)).resolves.toMatchObject({ status: 'RESTORED' });
    await expect(service.move(target, 7, '晴空案')).resolves.toMatchObject({ status: 'MOVED' });
    expect(repository.calls).toEqual(['DELETE', 'RESTORE', 'MOVE:晴空案']);
  });
});
