import { describe, expect, it, vi } from 'vitest';
import { MemoryRecoveryService } from './recovery';

const requeuedAt = new Date('2026-08-29T03:00:00Z');

describe('MemoryRecoveryService', () => {
  it('requeues only through the expected attempt fence and records normalized operator context', async () => {
    const requeueFailed = vi.fn(async () => true);
    const service = new MemoryRecoveryService({ requeueFailed });

    await expect(service.requeueFailed({
      requestId: 7,
      expectedAttemptCount: 4,
      operatorRef: '  ops-console:ryan  ',
      reason: '  credentials repaired  ',
      requeuedAt,
    })).resolves.toEqual({ status: 'REQUEUED', requestId: 7 });

    expect(requeueFailed).toHaveBeenCalledWith({
      requestId: 7,
      expectedAttemptCount: 4,
      operatorRef: 'ops-console:ryan',
      reason: 'credentials repaired',
      requeuedAt,
    });
  });

  it('does not claim recovery succeeded when the failed state or attempt fence no longer matches', async () => {
    const service = new MemoryRecoveryService({ requeueFailed: vi.fn(async () => false) });
    await expect(service.requeueFailed({
      requestId: 7,
      expectedAttemptCount: 3,
      operatorRef: 'ops-console:ryan',
      reason: 'retry after configuration fix',
      requeuedAt,
    })).resolves.toEqual({ status: 'NOT_REQUEUED', requestId: 7 });
  });

  it('rejects missing recovery attribution', async () => {
    const service = new MemoryRecoveryService({ requeueFailed: vi.fn(async () => true) });
    await expect(service.requeueFailed({
      requestId: 7,
      expectedAttemptCount: 3,
      operatorRef: ' ',
      reason: 'retry',
    })).rejects.toThrow('operatorRef');
  });
});
