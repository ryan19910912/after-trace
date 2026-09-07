import { describe, expect, it } from 'vitest';
import { AiEntitlementService, type AiEntitlementRepository, type AiEntitlementSnapshot } from './ai-entitlement';
import type { AiPointLedgerPort } from './entitled-ai-point-ledger';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';

const now = new Date('2026-09-07T09:00:00.000Z');
const periodEnd = new Date('2026-10-07T09:00:00.000Z');

class FakeEntitlementRepository implements AiEntitlementRepository {
  scopes: Array<{ grantId: number; sourceId: number }> = [];
  value: AiEntitlementSnapshot = {
    sourceAuthorized: true,
    freeTrial: { grantId: 11, remainingPoints: 80, perRequestAiPointCap: 50 },
    aiPro: null,
  };

  async snapshot() { return this.value; }
  async ensureGrantScope(grantId: number, sourceId: number) {
    this.scopes.push({ grantId, sourceId });
  }
}

function fakeLedger() {
  const calls: Array<Record<string, unknown>> = [];
  const port: AiPointLedgerPort = {
    async reserveAi(input) {
      calls.push(input);
      return {
        status: 'RESERVED',
        remainingAiPoints: 0,
        reservation: {
          id: 1,
          token: 'token',
          chargedUserId: input.chargedUserId,
          actorUserId: input.actorUserId,
          sourceId: Number(input.sourceId),
          entitlementGrantId: input.entitlementGrantId ?? null,
          pointsReserved: input.requestedPoints,
          pointsCommitted: 0,
          platformSubsidizedPoints: 0,
          providerCostHoldTwd: input.providerCostHoldTwd ?? null,
          status: 'RESERVED',
          expiresAt: new Date(now.getTime() + 60_000),
        },
      };
    },
    async commitAiUsage() { return { status: 'RESERVATION_NOT_FOUND' }; },
    async releaseAi() { return { status: 'RESERVATION_NOT_FOUND' }; },
  };
  return { port, calls };
}

function paidSnapshot(overrides: Partial<NonNullable<AiEntitlementSnapshot['aiPro']>> = {}): AiEntitlementSnapshot {
  return {
    sourceAuthorized: true,
    freeTrial: { grantId: 11, remainingPoints: 80, perRequestAiPointCap: 100 },
    aiPro: {
      planEnabled: true,
      aiEnabled: true,
      grantId: 22,
      periodStart: now,
      periodEnd,
      monthlyPointCap: 1000,
      monthlyProviderCostCapTwd: 30,
      perRequestAiPointCap: 100,
      pointsUsed: 200,
      providerCostTwd: 5,
      missingProviderCostTwdRequests: 0,
      ...overrides,
    },
  };
}

describe('EntitledAiPointLedgerService', () => {
  it('admits FREE trial and binds the reservation to the selected Grant without a paid TWD hold', async () => {
    const repository = new FakeEntitlementRepository();
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({
      chargedUserId: 7,
      actorUserId: 7,
      sourceId: 99,
      requestedPoints: 40,
      providerCostHoldTwd: 1.25,
      at: now,
    });

    expect(result.status).toBe('RESERVED');
    expect(repository.scopes).toEqual([{ grantId: 11, sourceId: 99 }]);
    expect(ledger.calls).toEqual([expect.objectContaining({
      entitlementGrantId: 11,
      providerCostHoldTwd: null,
    })]);
  });

  it('fails closed before the low-level ledger when Source authorization is missing', async () => {
    const repository = new FakeEntitlementRepository();
    repository.value = { sourceAuthorized: false, freeTrial: null, aiPro: null };
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({ chargedUserId: 7, actorUserId: 7, sourceId: 99, requestedPoints: 10, at: now });

    expect(result).toEqual({ status: 'AI_ENTITLEMENT_BLOCKED', reason: 'SOURCE_NOT_AUTHORIZED' });
    expect(ledger.calls).toEqual([]);
  });

  it('does not start an AI Pro request whose conservative point hold exceeds the remaining monthly cap', async () => {
    const repository = new FakeEntitlementRepository();
    repository.value = paidSnapshot({ pointsUsed: 950 });
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({
      chargedUserId: 7,
      actorUserId: 7,
      sourceId: 99,
      requestedPoints: 60,
      providerCostHoldTwd: 1,
      at: now,
    });

    expect(result).toEqual({ status: 'AI_ENTITLEMENT_BLOCKED', reason: 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED' });
    expect(repository.scopes).toEqual([]);
    expect(ledger.calls).toEqual([]);
  });

  it('fails closed when AI Pro cannot produce a positive TWD provider-cost hold', async () => {
    const repository = new FakeEntitlementRepository();
    repository.value = paidSnapshot();
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({
      chargedUserId: 7,
      actorUserId: 7,
      sourceId: 99,
      requestedPoints: 60,
      providerCostHoldTwd: null,
      at: now,
    });

    expect(result).toEqual({ status: 'AI_ENTITLEMENT_BLOCKED', reason: 'PROVIDER_COST_ACCOUNTING_INCOMPLETE' });
    expect(repository.scopes).toEqual([{ grantId: 22, sourceId: 99 }]);
    expect(ledger.calls).toEqual([]);
  });

  it('prefers AI Pro and forwards exact current-period Grant plus conservative TWD hold', async () => {
    const repository = new FakeEntitlementRepository();
    repository.value = paidSnapshot();
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({
      chargedUserId: 7,
      actorUserId: 7,
      sourceId: 99,
      requestedPoints: 60,
      providerCostHoldTwd: 1.5,
      at: now,
    });

    expect(result.status).toBe('RESERVED');
    expect(repository.scopes).toEqual([{ grantId: 22, sourceId: 99 }]);
    expect(ledger.calls).toEqual([expect.objectContaining({
      entitlementGrantId: 22,
      providerCostHoldTwd: 1.5,
    })]);
  });
});
