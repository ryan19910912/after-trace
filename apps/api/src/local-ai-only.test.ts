import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import type { Bindings } from './index';
afterEach(() => vi.unstubAllGlobals());
describe('production worker local AI boundary', () => {
  it('retires every old inference route without database, provider, or record writes', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const path of ['capture/text', 'capture/image', 'capture/audio', 'capture/file', 'capture/search', 'capture/summary', 'capture/rewrite', 'capture/related', 'task-proposal', 'entitlement']) {
      const response = await worker.fetch(new Request(`https://api.test/api/v1/ai/${path}`, { method: 'POST', body: '{}' }), {} as Bindings, { waitUntil: vi.fn() });
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ error: 'LOCAL_AI_ONLY' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects new purchases of retired cloud AI plans and callbacks without database or provider access', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const path of ['/payments/newebpay/checkout', '/payments/newebpay/cancel', '/payments/newebpay/notify', '/payments/newebpay/return', '/subscription/plans']) {
    const response = await worker.fetch(new Request('https://api.test/api/v1' + path, { method: 'POST', body: '{}' }), {} as Bindings, { waitUntil: vi.fn() });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: 'BILLING_RETIRED' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
