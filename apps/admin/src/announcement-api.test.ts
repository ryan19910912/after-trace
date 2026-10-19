import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminAnnouncementApi } from './announcement-api';

afterEach(() => vi.unstubAllGlobals());

describe('AdminAnnouncementApi', () => {
  it('previews a bounded announcement with the Admin bearer session', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/api/v1/admin/notifications/announcements/preview');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer admin-session');
      expect(JSON.parse(String(init?.body))).toEqual({
        title: '維護通知', body: '今晚維護', audience: 'ALL_USERS', specificUserIds: [],
        inAppEnabled: true, pushEnabled: true, deepLink: null, mode: 'SEND_NOW', scheduledAt: null,
      });
      return new Response(JSON.stringify({
        ok: true,
        preview: {
          title: '維護通知', body: '今晚維護', audience: 'ALL_USERS', specificUserIds: [],
          inAppEnabled: true, pushEnabled: true, deepLink: null, mode: 'SEND_NOW', scheduledAt: null,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchFn);

    const api = new AdminAnnouncementApi('https://api.example.test');
    api.setSessionToken('admin-session');
    const preview = await api.preview({
      title: '維護通知', body: '今晚維護', audience: 'ALL_USERS', specificUserIds: [],
      inAppEnabled: true, pushEnabled: true, deepLink: null, mode: 'SEND_NOW', scheduledAt: null,
    });

    expect(preview.mode).toBe('SEND_NOW');
    expect(preview.pushEnabled).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('uses the dedicated send and cancel lifecycle endpoints', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({
        ok: true,
        announcement: {
          id: 42, status: init?.method === 'DELETE' ? 'CANCELLED' : 'SENT', audience: 'FREE_USERS',
          title: '公告', body: '內容', inAppEnabled: true, pushEnabled: false, deepLink: null,
          scheduledAt: null, dispatchStartedAt: null, sentAt: null, cancelledAt: null,
          createdByActor: 'admin', createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z',
          recipientCount: 1, unreadCount: 1, pushSentCount: 0, pushFailedCount: 0,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchFn);

    const api = new AdminAnnouncementApi('https://api.example.test');
    api.setSessionToken('admin-session');
    await api.send(42);
    await api.cancel(42);

    expect(calls).toEqual([
      { url: 'https://api.example.test/api/v1/admin/notifications/announcements/42/send', method: 'POST' },
      { url: 'https://api.example.test/api/v1/admin/notifications/announcements/42', method: 'DELETE' },
    ]);
  });
});
