import { describe, expect, it, vi } from 'vitest';
import type { CreditLedgerRepository } from './ledger';
import { CreditLedgerService } from './ledger';

function repository(): CreditLedgerRepository {
  return {
    grant: vi.fn(async () => ({ status: 'APPLIED', operationId: 1 })),
    consume: vi.fn(async () => ({ status: 'APPLIED', operationId: 2 })),
    reservePaid: vi.fn(async () => ({ status: 'APPLIED', operationId: 3 })),
    releasePaidReservation: vi.fn(async () => ({ status: 'APPLIED', operationId: 4 })),
    consumePaidReservation: vi.fn(async () => ({ status: 'APPLIED', operationId: 5 })),
  };
}

describe('CreditLedgerService', () => {
  it('normalizes reconciliation references before persistence', async () => {
    const repo = repository();
    const service = new CreditLedgerService(repo);
    const at = new Date('2026-08-29T00:00:00Z');

    await service.consume(9, 12n, { type: ' ai_usage ', id: ' request-1 ' }, at);

    expect(repo.consume).toHaveBeenCalledWith(
      9,
      12n,
      { type: 'AI_USAGE', id: 'request-1' },
      at,
    );
  });

  it('rejects zero-value mutations before they reach the repository', async () => {
    const repo = repository();
    const service = new CreditLedgerService(repo);

    await expect(
      service.grant(1, 'WELCOME', 0n, { type: 'WELCOME', id: 'g-1' }),
    ).rejects.toThrow('credit amount');
    expect(repo.grant).not.toHaveBeenCalled();
  });

  it('uses the same reference for reserve and settlement operations', async () => {
    const repo = repository();
    const service = new CreditLedgerService(repo);
    const reference = { type: 'reminder', id: 'reminder-42' };

    await service.reservePaid(7, 500n, reference);
    await service.releasePaidReservation(7, reference);

    expect(repo.reservePaid).toHaveBeenCalledWith(
      7,
      500n,
      { type: 'REMINDER', id: 'reminder-42' },
      expect.any(Date),
    );
    expect(repo.releasePaidReservation).toHaveBeenCalledWith(
      7,
      { type: 'REMINDER', id: 'reminder-42' },
      expect.any(Date),
    );
  });
});
