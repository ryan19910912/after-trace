import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApi } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('AdminApi profitability', () => {
  it('requests the selected factual period with the Admin bearer session', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/api/v1/admin/profitability?period=30D');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer admin-session');
      return new Response(JSON.stringify({
        ok: true,
        report: {
          summary: {
            period: '30D', from: '2026-08-05T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z',
            requests: 0, chargedUsers: 0, customerPointsCharged: 0, platformSubsidizedPoints: 0,
            providerCostUsd: '0', providerCostTwd: '0', platformSubsidizedCostUsd: '0',
            platformSubsidizedCostTwd: '0', averagePointsPerRequest: 0,
            averageProviderCostTwdPerRequest: '0', averagePointsPerChargedUser: 0,
            averageProviderCostTwdPerChargedUser: '0', revenueTwd: null,
            realizedAiCostRatio: null, realizedGrossMargin: null,
            revenueStatus: 'UNAVAILABLE_NO_SUCCESSFUL_PAYMENT_FACT',
          },
          byModel: [], byOperation: [], bySourceType: [], byGrantType: [], grantInventory: [],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchFn);

    const api = new AdminApi('https://api.example.test');
    api.setSessionToken('admin-session');
    const report = await api.profitability('30D');

    expect(report.summary.period).toBe('30D');
    expect(report.summary.revenueTwd).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
