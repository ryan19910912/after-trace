import { describe, expect, it } from 'vitest';
import { issueAdminSessionToken } from './auth';
import { createAdminNotificationRoutes } from './notification-routes';
import type {
  AdminAnnouncementSummary,
  NotificationRepository,
} from '../worklog/notifications';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  ADMIN_WEB_ORIGIN: 'https://admin.example.test',
  ADMIN_USERNAME: 'admin-user',
  ADMIN_PASSWORD: 'correct-horse-battery-staple',
  ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
};

async function headers() {
  const token = await issueAdminSessionToken({ username: env.ADMIN_USERNAME, env, ttlSeconds: 3600 });
  return { authorization: `Bearer ${token}`, origin: env.ADMIN_WEB_ORIGIN, 'content-type': 'application/json' };
}

function summary(overrides: Partial<AdminAnnouncementSummary> = {}): AdminAnnouncementSummary {
  return {
    id: 40,
    status: 'DRAFT',
    audience: 'ALL_USERS',
    title: '維護公告',
    body: '今晚維護',
    inAppEnabled: true,
    pushEnabled: false,
    deepLink: null,
    scheduledAt: null,
    dispatchStartedAt: null,
    sentAt: null,
    cancelledAt: null,
    createdByActor: env.ADMIN_USERNAME,
    createdAt: '2026-09-07T03:00:00.000Z',
    updatedAt: '2026-09-07T03:00:00.000Z',
    recipientCount: 0,
    unreadCount: 0,
    pushSentCount: 0,
    pushFailedCount: 0,
    ...overrides,
  };
}

function repository(overrides: Partial<NotificationRepository> = {}): NotificationRepository {
  return {
    async listForUser() { return { items: [], unreadCount: 0 }; },
    async markRead() { return null; },
    async markAllRead() { return 0; },
    async createSystemNotification() { return { notificationId: 1, idempotent: false }; },
    async createAnnouncement() { return { announcement: summary() }; },
    async dispatchAnnouncement() { return { status: 'SENT', announcement: summary({ status: 'SENT', recipientCount: 3 }) }; },
    async cancelAnnouncement() { return { status: 'CANCELLED', announcement: summary({ status: 'CANCELLED' }) }; },
    async listAnnouncements() { return [summary()]; },
    async announcementDetail() { return summary(); },
    ...overrides,
  };
}

describe('Admin announcement routes', () => {
  it('previews SPECIFIC_USERS without widening the audience or persisting', async () => {
    let createCalls = 0;
    const app = createAdminNotificationRoutes({
      databaseFactory: () => ({} as never),
      repositoryFactory: () => repository({
        async createAnnouncement() {
          createCalls += 1;
          return { announcement: summary() };
        },
      }),
    });

    const response = await app.request('/announcements/preview', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        mode: 'DRAFT',
        title: '指定公告',
        body: '只給指定帳號',
        audience: 'SPECIFIC_USERS',
        specificUserIds: [7, 9],
        inAppEnabled: true,
        pushEnabled: false,
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(createCalls).toBe(0);
    const body = await response.json() as { preview: { audience: string; specificUserIds: number[] } };
    expect(body.preview.audience).toBe('SPECIFIC_USERS');
    expect(body.preview.specificUserIds).toEqual([7, 9]);
  });

  it('creates and synchronously fans out SEND_NOW announcements through dispatch', async () => {
    let dispatchId = 0;
    const app = createAdminNotificationRoutes({
      databaseFactory: () => ({} as never),
      repositoryFactory: () => repository({
        async createAnnouncement(input) {
          expect(input.createdByActor).toBe(env.ADMIN_USERNAME);
          return { announcement: summary({ audience: input.audience }) };
        },
        async dispatchAnnouncement(id) {
          dispatchId = id;
          return { status: 'SENT', announcement: summary({ status: 'SENT', recipientCount: 12 }) };
        },
      }),
    });

    const response = await app.request('/announcements', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        mode: 'SEND_NOW',
        title: '系統更新',
        body: '今晚 23:00 更新',
        audience: 'ALL_USERS',
        inAppEnabled: true,
        pushEnabled: true,
      }),
    }, env);

    expect(response.status).toBe(201);
    expect(dispatchId).toBe(40);
    const body = await response.json() as { announcement: AdminAnnouncementSummary };
    expect(body.announcement.status).toBe('SENT');
    expect(body.announcement.recipientCount).toBe(12);
  });

  it('rejects an empty SPECIFIC_USERS audience before persistence', async () => {
    let createCalls = 0;
    const app = createAdminNotificationRoutes({
      databaseFactory: () => ({} as never),
      repositoryFactory: () => repository({
        async createAnnouncement() {
          createCalls += 1;
          return { announcement: summary() };
        },
      }),
    });

    const response = await app.request('/announcements', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        mode: 'DRAFT',
        title: '指定公告',
        body: '內容',
        audience: 'SPECIFIC_USERS',
        specificUserIds: [],
        inAppEnabled: true,
        pushEnabled: false,
      }),
    }, env);

    expect(response.status).toBe(400);
    expect(createCalls).toBe(0);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'SPECIFIC_USERS_REQUIRED' });
  });
});
