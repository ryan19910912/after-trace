import { describe, expect, it, vi } from 'vitest';
import { UserEnergyLedgerService, type UserEnergyMutationRepository } from './ledger';

function repository(): UserEnergyMutationRepository {
  return {
    consume: vi.fn(async () => ({ status: 'APPLIED' as const, operationId: 1 })),
    reserve: vi.fn(async () => ({ status: 'APPLIED' as const, operationId: 2, reservationId: 3 })),
    releaseReservation: vi.fn(async () => ({ status: 'APPLIED' as const, operationId: 4, reservationId: 3 })),
    consumeReservation: vi.fn(async () => ({ status: 'APPLIED' as const, operationId: 5, reservationId: 3 })),
  };
}

describe('UserEnergyLedgerService', () => {
  it('rejects non-positive consumption before persistence', async () => {
    const repo = repository();
    const service = new UserEnergyLedgerService(repo);
    expect(() => service.consume({
      userId: 1,
      units: 0n,
      at: new Date(),
      reference: { type: 'AI_USAGE', id: 'req-1' },
    })).toThrow('positive');
    expect(repo.consume).not.toHaveBeenCalled();
  });

  it('normalizes references and forwards caller-owned consumption', async () => {
    const repo = repository();
    const service = new UserEnergyLedgerService(repo);
    const at = new Date('2026-08-29T00:00:00Z');
    await service.consume({
      userId: 7,
      units: 12n,
      at,
      reference: { type: ' AI_USAGE ', id: ' request-7 ' },
    });
    expect(repo.consume).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      units: 12n,
      reference: { type: 'AI_USAGE', id: 'request-7' },
    }));
  });

  it('allows only subscription/paid reminder reservation buckets', () => {
    const service = new UserEnergyLedgerService(repository());
    expect(() => service.reserve({
      userId: 1,
      units: 10n,
      at: new Date('2026-08-29T00:00:00Z'),
      validThrough: new Date('2026-08-30T00:00:00Z'),
      reference: { type: 'REMINDER', id: 'r1' },
      allowedBuckets: ['FREE' as never],
    })).toThrow('SUBSCRIPTION/PAID');
  });

  it('rejects subscription reservation whose required validity is already past', () => {
    const service = new UserEnergyLedgerService(repository());
    expect(() => service.reserve({
      userId: 1,
      units: 10n,
      at: new Date('2026-08-30T00:00:00Z'),
      validThrough: new Date('2026-08-29T00:00:00Z'),
      reference: { type: 'REMINDER', id: 'r1' },
    })).toThrow('validThrough');
  });
});
