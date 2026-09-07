import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCommercialApi } from './commercial-api';

afterEach(() => vi.restoreAllMocks());

describe('AdminCommercialApi', () => {
  it('uses Admin bearer auth and maps the FREE trial config', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      config: {
        freeInitialAiTrialPoints: 500,
        updatedBy: 'admin',
        updatedAt: '2026-09-07T08:00:00.000Z',
        recipients: 3,
        exhaustedRecipients: 1,
        issuedPoints: 1500,
        remainingPoints: 600,
        consumedPoints: 900,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = new AdminCommercialApi('https://api.example');
    api.setSessionToken('admin-session');

    const config = await api.getFreeAiTrial();

    expect(config?.freeInitialAiTrialPoints).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer admin-session');
  });

  it('treats missing config as uninitialized instead of inventing zero points', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: 'FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED',
    }), { status: 404 }));
    const api = new AdminCommercialApi('https://api.example');
    api.setSessionToken('admin-session');
    expect(await api.getFreeAiTrial()).toBeNull();
  });

  it('sends the point quantity and never a TWD trial value', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      config: {
        freeInitialAiTrialPoints: 800, updatedBy: 'admin', updatedAt: '2026-09-07T08:00:00.000Z',
        recipients: 0, exhaustedRecipients: 0, issuedPoints: 0, remainingPoints: 0, consumedPoints: 0,
      },
    }), { status: 200 }));
    const api = new AdminCommercialApi('https://api.example');
    api.setSessionToken('admin-session');
    await api.setFreeAiTrial(800);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ freeInitialAiTrialPoints: 800 });
  });

  it('sends AI capability gates with the fixed AI Pro hard-cap configuration', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      config: {
        code: 'AI_PRO',
        displayName: 'AI Pro',
        priceTwd: '99.00',
        enabled: true,
        aiEnabled: true,
        aiMediaIngestion: true,
        aiNaturalSearch: false,
        aiRelatedRecords: true,
        monthlyAiPointCap: 100000,
        monthlyProviderCostCapTwd: '30',
        perRequestAiPointCap: 5000,
        updatedAt: '2026-09-07T08:00:00.000Z',
      },
    }), { status: 200 }));
    const api = new AdminCommercialApi('https://api.example');
    api.setSessionToken('admin-session');

    const config = await api.setAiPro({
      enabled: true,
      aiMediaIngestion: true,
      aiNaturalSearch: false,
      aiRelatedRecords: true,
      monthlyAiPointCap: 100000,
      monthlyProviderCostCapTwd: '30',
      perRequestAiPointCap: 5000,
    });

    expect(config.priceTwd).toBe('99.00');
    expect(config.aiNaturalSearch).toBe(false);
    expect(config.aiRelatedRecords).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      enabled: true,
      aiMediaIngestion: true,
      aiNaturalSearch: false,
      aiRelatedRecords: true,
      monthlyAiPointCap: 100000,
      monthlyProviderCostCapTwd: '30',
      perRequestAiPointCap: 5000,
    });
  });
});
