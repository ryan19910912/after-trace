import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCaptureApi } from './ai-capture-api';

const api = new AiCaptureApi('https://api.example.test');

afterEach(() => vi.unstubAllGlobals());

describe('AiCaptureApi', () => {
  it('reads provider-neutral entitlement for one Source', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      ok: true,
      entitlement: {
        source: 'FREE_TRIAL',
        allowed: true,
        reason: 'FREE_TRIAL_AVAILABLE',
        remainingPoints: 80,
        periodEndsAt: null,
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const value = await api.entitlement('session', 12);

    expect(value.source).toBe('FREE_TRIAL');
    expect(value.remainingPoints).toBe(80);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/ai/entitlement?sourceId=12');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer session');
  });

  it('persists AI text through the target AI capture endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      ok: true,
      status: 'CREATED',
      entitlementSource: 'AI_PRO',
      record: {
        id: 91,
        sourceId: 12,
        authorUserId: 7,
        rawText: '今天晴空案收到款項',
        title: '晴空案收款',
        searchTerms: ['晴空案', '收款'],
        occurredAt: '2026-09-07T00:00:00.000Z',
        createdAt: '2026-09-07T09:30:00.000Z',
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const value = await api.captureText('session', 12, '今天晴空案收到款項');

    expect(value.entitlementSource).toBe('AI_PRO');
    expect(value.record.title).toBe('晴空案收款');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ sourceId: 12, text: '今天晴空案收到款項' });
  });

  it('surfaces durable hard-cap reasons from the backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      ok: false,
      error: 'MONTHLY_PROVIDER_COST_CAP_REACHED',
    }, 409)));

    await expect(api.captureText('session', 12, 'test'))
      .rejects.toThrow('MONTHLY_PROVIDER_COST_CAP_REACHED');
  });
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
