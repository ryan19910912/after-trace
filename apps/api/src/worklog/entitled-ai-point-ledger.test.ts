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
          pointsReserved: input.requestedPoints,
          pointsCommitted: 0,
          platformSubsidizedPoints: 0,
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

describe('EntitledAiPointLedgerService', () => {
  it('admits an eligible FREE trial request and activates that users selected Grant scope before reserve', async () => {
    const repository = new FakeEntitlementRepository();
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({
      chargedUserId: 7,
      actorUserId: 7,
      sourceId: 99,
      requestedPoints: 40,
      at: now,
    });

    expect(result.status).toBe('RESERVED');
    expect(repository.scopes).toEqual([{ grantId: 11, sourceId: 99 }]);
    expect(ledger.calls).toHaveLength(1);
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

  it('does not start an AI Pro request whose conservative hold would exceed the remaining monthly point cap', async () => {
    const repository = new FakeEntitlementRepository();
    repository.value = {
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
        pointsUsed: 950,
        providerCostTwd: 5,
        missingProviderCostTwdRequests: 0,
      },
    };
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({ chargedUserId: 7, actorUserId: 7, sourceId: 99, requestedPoints: 60, at: now });

    expect(result).toEqual({ status: 'AI_ENTITLEMENT_BLOCKED', reason: 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED' });
    expect(repository.scopes).toEqual([]);
    expect(ledger.calls).toEqual([]);
  });

  it('prefers AI Pro over a remaining FREE trial and activates only the current AI Pro Grant for the Source', async () => {
    const repository = new FakeEntitlementRepository();
    repository.value = {
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
      },
    };
    const ledger = fakeLedger();
    const service = new EntitledAiPointLedgerService(new AiEntitlementService(repository), ledger.port);

    const result = await service.reserveAi({ chargedUserId: 7, actorUserId: 7, sourceId: 99, requestedPoints: 60, at: now });

    expect(result.status).toBe('RESERVED');
    expect(repository.scopes).toEqual([{ grantId: 22, sourceId: 99 }]);
    expect(ledger.calls).toHaveLength(1);
  });
});
