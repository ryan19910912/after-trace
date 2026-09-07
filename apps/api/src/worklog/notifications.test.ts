import { describe, expect, it } from 'vitest';
import {
  NotificationService,
  type AdminAnnouncementSummary,
  type NotificationRepository,
  type SystemNotificationInput,
} from './notifications';

function summary(overrides: Partial<AdminAnnouncementSummary> = {}): AdminAnnouncementSummary {
  return {
    id: 1,
    status: 'DRAFT',
    audience: 'ALL_USERS',
    title: '公告',
    body: '內容',
    inAppEnabled: true,
    pushEnabled: false,
    deepLink: null,
    scheduledAt: null,
    dispatchStartedAt: null,
    sentAt: null,
    cancelledAt: null,
    createdByActor: 'admin',
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
    async dispatchAnnouncement() { return { status: 'SENT', announcement: summary({ status: 'SENT' }) }; },
    async cancelAnnouncement() { return { status: 'CANCELLED', announcement: summary({ status: 'CANCELLED' }) }; },
    async listAnnouncements() { return []; },
    async announcementDetail() { return null; },
    ...overrides,
  };
}

describe('NotificationService', () => {
  it('keeps SYSTEM event creation deterministic and user-scoped at the repository boundary', async () => {
    let captured: SystemNotificationInput | null = null;
    const service = new NotificationService(repository({
      async createSystemNotification(input) {
        captured = input;
        return { notificationId: 55, idempotent: true };
      },
    }));

    const result = await service.createSystemNotification({
      eventKey: 'subscription:period:991:activated',
      userId: 7,
      title: 'AI Pro 已啟用',
      body: '你的 AI Pro 訂閱已啟用。',
    });

    expect(result).toEqual({ notificationId: 55, idempotent: true });
    expect(captured).toMatchObject({
      eventKey: 'subscription:period:991:activated',
      userId: 7,
      pushEnabled: true,
    });
  });

  it('requires at least one delivery channel for Admin announcements', async () => {
    const service = new NotificationService(repository());
    await expect(service.createAnnouncement({
      title: '維護公告',
      body: '今晚維護',
      audience: 'ALL_USERS',
      specificUserIds: [],
      inAppEnabled: false,
      pushEnabled: false,
      createdByActor: 'admin',
    })).rejects.toThrow('NOTIFICATION_CHANNEL_REQUIRED');
  });

  it('never silently broadens SPECIFIC_USERS to all users', async () => {
    const service = new NotificationService(repository());
    await expect(service.createAnnouncement({
      title: '指定公告',
      body: '只給指定帳號',
      audience: 'SPECIFIC_USERS',
      specificUserIds: [],
      inAppEnabled: true,
      pushEnabled: false,
      createdByActor: 'admin',
    })).rejects.toThrow('SPECIFIC_USERS_REQUIRED');
  });

  it('deduplicates explicit user ids before persistence', async () => {
    let capturedIds: number[] = [];
    const service = new NotificationService(repository({
      async createAnnouncement(input) {
        capturedIds = input.specificUserIds;
        return { announcement: summary({ audience: 'SPECIFIC_USERS' }) };
      },
    }));
    await service.createAnnouncement({
      title: '指定公告',
      body: '內容',
      audience: 'SPECIFIC_USERS',
      specificUserIds: [7, 7, 9],
      inAppEnabled: true,
      pushEnabled: true,
      createdByActor: 'admin',
    });
    expect(capturedIds).toEqual([7, 9]);
  });
});
