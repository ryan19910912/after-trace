import { describe, expect, it } from 'vitest';
import {
  WorklogConfirmationService,
  type WorklogConfirmationRepository,
  type WorklogConfirmationResolution,
  type WorklogPendingConfirmation,
} from './confirmations';

class FakeRepository implements WorklogConfirmationRepository {
  calls: Array<{ kind: string; input: unknown }> = [];
  pending: WorklogPendingConfirmation[] = [];
  result: WorklogConfirmationResolution = { status: 'NOT_FOUND' };

  async listPending(input: { requestedUserId: number; sourceId: number; at: Date }) {
    this.calls.push({ kind: 'list', input });
    return this.pending;
  }

  async resolveExisting(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    entityId: number;
    at: Date;
  }) {
    this.calls.push({ kind: 'existing', input });
    return this.result;
  }

  async resolveNewTitle(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    title: string;
    at: Date;
  }) {
    this.calls.push({ kind: 'new-title', input });
    return this.result;
  }

  async reject(input: { confirmationId: number; requestedUserId: number; sourceId: number; at: Date }) {
    this.calls.push({ kind: 'reject', input });
    return this.result;
  }
}

describe('WorklogConfirmationService', () => {
  it('lists only through the durable repository without provider work', async () => {
    const repository = new FakeRepository();
    const at = new Date('2026-09-04T00:00:00.000Z');
    const service = new WorklogConfirmationService(repository);

    expect(await service.listPending(7, 9, at)).toEqual([]);
    expect(repository.calls).toEqual([{ kind: 'list', input: { requestedUserId: 7, sourceId: 9, at } }]);
  });

  it('routes candidate selection to deterministic existing-entity resolution', async () => {
    const repository = new FakeRepository();
    repository.result = {
      status: 'CONFIRMED',
      confirmationId: 3,
      recordId: 11,
      entityId: 22,
      title: '晴空案',
      createdEntity: false,
      aliasCreated: true,
    };
    const service = new WorklogConfirmationService(repository);

    const result = await service.resolve({
      confirmationId: 3,
      requestedUserId: 7,
      sourceId: 9,
      decision: { kind: 'USE_EXISTING', entityId: 22 },
      at: new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(result.status).toBe('CONFIRMED');
    expect(repository.calls[0]?.kind).toBe('existing');
  });

  it('allows CREATE_TITLE to fall back to the stored proposed title', async () => {
    const repository = new FakeRepository();
    const service = new WorklogConfirmationService(repository);

    await service.resolve({
      confirmationId: 3,
      requestedUserId: 7,
      sourceId: 9,
      decision: { kind: 'CREATE_TITLE' },
      at: new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(repository.calls[0]).toMatchObject({
      kind: 'new-title',
      input: { confirmationId: 3, requestedUserId: 7, sourceId: 9, title: '' },
    });
  });

  it('rejects a stored decision without invoking any AI path', async () => {
    const repository = new FakeRepository();
    repository.result = { status: 'REJECTED', confirmationId: 3, recordId: 11 };
    const service = new WorklogConfirmationService(repository);

    expect(await service.resolve({
      confirmationId: 3,
      requestedUserId: 7,
      sourceId: 9,
      decision: { kind: 'REJECT' },
    })).toMatchObject({ status: 'REJECTED' });
    expect(repository.calls[0]?.kind).toBe('reject');
  });

  it('rejects invalid ids before repository mutation', async () => {
    const repository = new FakeRepository();
    const service = new WorklogConfirmationService(repository);

    await expect(service.resolve({
      confirmationId: 0,
      requestedUserId: 7,
      sourceId: 9,
      decision: { kind: 'REJECT' },
    })).rejects.toThrow('confirmationId');
    expect(repository.calls).toEqual([]);
  });
});
