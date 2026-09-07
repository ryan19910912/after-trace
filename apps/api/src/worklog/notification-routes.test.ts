import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createNotificationRoutes } from './notification-routes';
import type { NotificationRepository } from './notifications';
import type { PushNotificationRepository } from './push-notifications';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
  WEB_PUSH_PUBLIC_KEY: 'BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A',
  WEB_PUSH_PRIVATE_KEY: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
  WEB_PUSH_SUBJECT: 'mailto:support@example.test',
};

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function headers(authorization: string, json = false) {
  return {
    authorization,
    origin: env.WEB_APP_ORIGIN,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
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

function pushRepository(overrides: Partial<PushNotificationRepository> = {}): PushNotificationRepository {
  return {
    async state() {
      return {
        activeSubscriptionCount: 0,
        preferences: {
          announcementPushEnabled: true,
          systemPushEnabled: true,
          taskPushEnabled: true,
        },
      };
    },
    async upsertSubscription() {},
    async revokeSubscription() { return false; },
    async updatePreferences() {
      return {
        announcementPushEnabled: true,
        systemPushEnabled: true,
        taskPushEnabled: true,
      };
    },
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

  it('returns provider-neutral per-user push state only when complete server VAPID config is present', async () => {
    let requestedUserId = 0;
    const app = createNotificationRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      pushRepositoryFactory: () => pushRepository({
        async state(userId) {
          requestedUserId = userId;
          return {
            activeSubscriptionCount: 2,
            preferences: {
              announcementPushEnabled: true,
              systemPushEnabled: false,
              taskPushEnabled: true,
            },
          };
        },
      }),
    });

    const response = await app.request('/push', { headers: headers(await authorization(44)) }, env);
    expect(response.status).toBe(200);
    expect(requestedUserId).toBe(44);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      serverPushEnabled: true,
      publicKey: env.WEB_PUSH_PUBLIC_KEY,
      activeSubscriptionCount: 2,
      preferences: {
        announcementPushEnabled: true,
        systemPushEnabled: false,
        taskPushEnabled: true,
      },
    });
  });

  it('registers a push endpoint only for the authenticated account', async () => {
    let registeredUserId = 0;
    let registeredEndpoint = '';
    const app = createNotificationRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      pushRepositoryFactory: () => pushRepository({
        async upsertSubscription(userId, input) {
          registeredUserId = userId;
          registeredEndpoint = input.endpoint;
        },
        async state() {
          return {
            activeSubscriptionCount: 1,
            preferences: {
              announcementPushEnabled: true,
              systemPushEnabled: true,
              taskPushEnabled: true,
            },
          };
        },
      }),
    });

    const response = await app.request('/push/subscription', {
      method: 'POST',
      headers: headers(await authorization(55), true),
      body: JSON.stringify({
        endpoint: 'https://push.example.test/device/1',
        keys: { p256dh: 'public-device-key', auth: 'device-auth' },
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(registeredUserId).toBe(55);
    expect(registeredEndpoint).toBe('https://push.example.test/device/1');
  });

  it('fails closed when the Web Push server configuration is incomplete', async () => {
    const app = createNotificationRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      pushRepositoryFactory: () => pushRepository(),
    });
    const noPushEnv = { ...env, WEB_PUSH_PRIVATE_KEY: '' };

    const stateResponse = await app.request('/push', { headers: headers(await authorization()) }, noPushEnv);
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      ok: true,
      serverPushEnabled: false,
      publicKey: null,
    });

    const response = await app.request('/push/subscription', {
      method: 'POST',
      headers: headers(await authorization(), true),
      body: JSON.stringify({
        endpoint: 'https://push.example.test/device/1',
        keys: { p256dh: 'public-device-key', auth: 'device-auth' },
      }),
    }, noPushEnv);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'PUSH_NOT_CONFIGURED' });
  });
});
