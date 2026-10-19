import { describe, expect, it } from 'vitest';
import {
  worklogNotificationPreferences,
  worklogNotificationRecipients,
  worklogNotifications,
  worklogPushSubscriptions,
} from '../db/schema-worklog-notification';
import {
  WORKLOG_NOTIFICATION_AUDIENCES,
  WORKLOG_NOTIFICATION_DELIVERY_STATUSES,
  WORKLOG_NOTIFICATION_STATUSES,
  WORKLOG_NOTIFICATION_TYPES,
} from './domain-values';

describe('notification schema contract', () => {
  it('keeps the accepted product notification categories explicit in application rules', () => {
    expect(WORKLOG_NOTIFICATION_TYPES).toEqual(['ANNOUNCEMENT', 'SYSTEM', 'TASK']);
    expect(worklogNotifications.type.dataType).toBe('string');
  });

  it('supports admin announcement scheduling and audience selection', () => {
    expect(WORKLOG_NOTIFICATION_AUDIENCES).toEqual([
      'ALL_USERS',
      'FREE_USERS',
      'AI_SUBSCRIBERS',
      'SPECIFIC_USERS',
    ]);
    expect(WORKLOG_NOTIFICATION_STATUSES).toEqual([
      'DRAFT',
      'SCHEDULED',
      'SENDING',
      'SENT',
      'CANCELLED',
      'FAILED',
    ]);
    expect(worklogNotifications.audience.dataType).toBe('string');
    expect(worklogNotifications.status.dataType).toBe('string');
    expect(worklogNotifications.scheduledAt.notNull).toBe(false);
    expect(worklogNotifications.inAppEnabled.notNull).toBe(true);
    expect(worklogNotifications.pushEnabled.notNull).toBe(true);
  });

  it('stores durable per-user read state and idempotent push delivery state', () => {
    expect(WORKLOG_NOTIFICATION_DELIVERY_STATUSES).toEqual([
      'PENDING',
      'SENT',
      'FAILED',
      'SKIPPED',
    ]);
    expect(worklogNotificationRecipients.notificationId.notNull).toBe(true);
    expect(worklogNotificationRecipients.userId.notNull).toBe(true);
    expect(worklogNotificationRecipients.readAt.notNull).toBe(false);
    expect(worklogNotificationRecipients.pushStatus.notNull).toBe(true);
    expect(worklogNotificationRecipients.pushStatus.dataType).toBe('string');
  });

  it('keeps Web Push endpoints separate from account identity', () => {
    expect(worklogPushSubscriptions.userId.notNull).toBe(true);
    expect(worklogPushSubscriptions.endpoint.notNull).toBe(true);
    expect(worklogPushSubscriptions.p256dh.notNull).toBe(true);
    expect(worklogPushSubscriptions.auth.notNull).toBe(true);
    expect(worklogPushSubscriptions.revokedAt.notNull).toBe(false);
  });

  it('keeps push preferences separate by notification category', () => {
    expect(worklogNotificationPreferences.announcementPushEnabled.default).toBe(true);
    expect(worklogNotificationPreferences.systemPushEnabled.default).toBe(true);
    expect(worklogNotificationPreferences.taskPushEnabled.default).toBe(true);
  });
});
