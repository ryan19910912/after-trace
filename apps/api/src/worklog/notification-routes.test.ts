import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createNotificationRoutes } from './notification-routes';
import type { NotificationRepository } from './notifications';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function headers(authorization: string) {
  return { authorization, origin: env.WEB_APP_ORIGIN };
}

function repository(overrides: Partial<NotificationRepository> = {}): NotificationRepository {
  return {
    async listForUser() { return { items: [], unreadCount: 0 }; },
    async markRead() { return null; },
    async markAllRead() { return 0; },
    async createSystemNotification() { return { notificationId: 1, idempotent: false }; },
    async createAnnouncement() { throw new Error('NOT_USED'); },
    async dispatchAnnouncement() { return { status: 'NOT_FOUND' }; },
    async cancelAnnouncement() { return { status: 'NOT_FOUND' }; },
    async listAnnouncements() { return []; },
    async announcementDetail() { return null; },
    ...overrides,
  };
}

describe('notification center routes', () => {
  it('uses durable Web session user id and returns unread state', async () => {
    let requestedUserId = 0;
    const app = createNotificationRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async listForUser(userId) {
          requestedUserId = userId;
          return {
            unreadCount: 1,
            items: [{
              id: 91,
              category: 'SYSTEM',
              title: 'AI Pro 已啟用',
              body: '訂閱已啟用',
              deepLink: '/subscription',
              createdAt: '2026-09-07T03:00:00.000Z',
              sentAt: '2026-09-07T03:00:00.000Z',
              readAt: null,
            }],
          };
        },
      }),
    });

    const response = await app.request('/', { headers: headers(await authorization(23)) }, env);
    expect(response.status).toBe(200);
    expect(requestedUserId).toBe(23);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      unreadCount: 1,
      items: [{
        id: 91,
        category: 'SYSTEM',
        title: 'AI Pro 已啟用',
        body: '訂閱已啟用',
        deepLink: '/subscription',
        createdAt: '2026-09-07T03:00:00.000Z',
        sentAt: '2026-09-07T03:00:00.000Z',
        readAt: null,
      }],
    });
  });

  it('cannot mark another users notification as read', async () => {
    const app = createNotificationRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({ async markRead() { return null; } }),
    });

    const response = await app.request('/999/read', {
      method: 'PATCH',
      headers: headers(await authorization()),
    }, env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'NOTIFICATION_NOT_FOUND' });
  });

  it('marks all current IN_APP notifications read for only the authenticated user', async () => {
    let requestedUserId = 0;
    const app = createNotificationRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async markAllRead(userId) {
          requestedUserId = userId;
          return 4;
        },
      }),
    });

    const response = await app.request('/read-all', {
      method: 'POST',
      headers: headers(await authorization(31)),
    }, env);

    expect(response.status).toBe(200);
    expect(requestedUserId).toBe(31);
    await expect(response.json()).resolves.toEqual({ ok: true, updatedCount: 4 });
  });
});
