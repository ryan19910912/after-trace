import { describe, expect, it, vi } from 'vitest';
import { defaultProductConfig } from '../config/product';
import type { CreditLedgerMutation } from './ledger';
import {
  WelcomeCreditService,
  type WelcomeAttribution,
  type WelcomeCreditLedgerPort,
  type WelcomeCreditRepository,
} from './welcome';

const attribution: WelcomeAttribution = {
  id: 11,
  groupId: 7,
  lineUserId: 'U123',
  isFirstGroup: true,
  amountUnits: 100_000_000n,
  grantOperationId: null,
  state: 'CREATED',
};

describe('WelcomeCreditService', () => {
  it('grants first-group welcome credit through the idempotent ledger', async () => {
    const repository: WelcomeCreditRepository = {
      claimAttribution: vi.fn(async () => attribution),
      completeAttribution: vi.fn(async () => 'COMPLETED' as const),
    };
    const grant = vi.fn(
      async (): Promise<CreditLedgerMutation> => ({ status: 'APPLIED', operationId: 91 }),
    );
    const ledger: WelcomeCreditLedgerPort = { grant };
    const service = new WelcomeCreditService(repository, ledger, defaultProductConfig);

    await expect(service.ensureForObservedMember(7, 'U123')).resolves.toMatchObject({
      status: 'GRANTED',
      isFirstGroup: true,
      amountUnits: 100_000_000n,
      operationId: 91,
    });
    expect(grant).toHaveBeenCalledWith(
      7,
      'WELCOME',
      100_000_000n,
      { type: 'WELCOME_GROUP', id: '7' },
      expect.any(Date),
    );
  });

  it('does not grant again when attribution already owns an operation', async () => {
    const repository: WelcomeCreditRepository = {
      claimAttribution: vi.fn(async () => ({ ...attribution, grantOperationId: 91, state: 'EXISTING' })),
      completeAttribution: vi.fn(async () => 'ALREADY_COMPLETED' as const),
    };
    const grant = vi.fn();
    const service = new WelcomeCreditService(
      repository,
      { grant } as unknown as WelcomeCreditLedgerPort,
      defaultProductConfig,
    );

    await expect(service.ensureForObservedMember(7, 'U123')).resolves.toMatchObject({
      status: 'ALREADY_GRANTED',
      operationId: 91,
    });
    expect(grant).not.toHaveBeenCalled();
  });
});
