import { describe, expect, it } from 'vitest';
import {
  WORKLOG_PRIVATE_INPUT_MODE_TTL_MS,
  WorklogPrivateInputModeService,
  type WorklogPrivateInputModeRepository,
} from './oa-input-mode';

class FakeRepository implements WorklogPrivateInputModeRepository {
  row: { action: 'RECORD' | 'QUERY'; expiresAt: Date } | null = null;

  async set(input: { action: 'RECORD' | 'QUERY'; expiresAt: Date }): Promise<void> {
    this.row = { action: input.action, expiresAt: input.expiresAt };
  }

  async consume(_userId: number, at: Date) {
    const row = this.row;
    this.row = null;
    if (!row) return { status: 'NONE' as const };
    return row.expiresAt.getTime() <= at.getTime()
      ? { status: 'EXPIRED' as const }
      : { status: 'ACTIVE' as const, action: row.action };
  }

  async clear(): Promise<void> {
    this.row = null;
  }
}

describe('WorklogPrivateInputModeService', () => {
  it('sets a ten-minute mode and consumes it once', async () => {
    const repository = new FakeRepository();
    const service = new WorklogPrivateInputModeService(repository);
    const at = new Date('2026-09-06T05:00:00.000Z');

    await service.set(7, 'RECORD', at);
    expect(repository.row?.expiresAt.toISOString()).toBe(
      new Date(at.getTime() + WORKLOG_PRIVATE_INPUT_MODE_TTL_MS).toISOString(),
    );
    await expect(service.consume(7, new Date(at.getTime() + 60_000))).resolves.toEqual({
      status: 'ACTIVE',
      action: 'RECORD',
    });
    await expect(service.consume(7, new Date(at.getTime() + 120_000))).resolves.toEqual({ status: 'NONE' });
  });

  it('consumes an expired mode as EXPIRED instead of reusing it', async () => {
    const repository = new FakeRepository();
    const service = new WorklogPrivateInputModeService(repository);
    const at = new Date('2026-09-06T05:00:00.000Z');

    await service.set(7, 'QUERY', at);
    await expect(service.consume(7, new Date(at.getTime() + WORKLOG_PRIVATE_INPUT_MODE_TTL_MS))).resolves.toEqual({
      status: 'EXPIRED',
    });
    expect(repository.row).toBeNull();
  });

  it('clears a pending mode without consuming an input message', async () => {
    const repository = new FakeRepository();
    const service = new WorklogPrivateInputModeService(repository);
    const at = new Date('2026-09-06T05:00:00.000Z');

    await service.set(7, 'RECORD', at);
    await service.clear(7);
    expect(repository.row).toBeNull();
    await expect(service.consume(7, new Date(at.getTime() + 60_000))).resolves.toEqual({ status: 'NONE' });
  });
});
