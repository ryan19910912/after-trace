import { describe, expect, it } from 'vitest';
import {
  worklogNotificationAudienceEnum,
  worklogNotificationDeliveryStatusEnum,
  worklogNotificationPreferences,
  worklogNotificationRecipients,
  worklogNotificationStatusEnum,
  worklogNotifications,
  worklogNotificationTypeEnum,
  worklogPushSubscriptions,
} from '../db/schema-worklog-notification';

describe('notification schema contract', () => {
  it('keeps the accepted product notification categories explicit', () => {
    expect(worklogNotificationTypeEnum.enumValues).toEqual([
      'ANNOUNCEMENT',
      'SYSTEM',
      'TASK',
    ]);
  });

  it('supports admin announcement scheduling and audience selection', () => {
    expect(worklogNotificationAudienceEnum.enumValues).toEqual([
      'ALL_USERS',
      'FREE_USERS',
      'AI_SUBSCRIBERS',
      'SPECIFIC_USERS',
    ]);
    expect(worklogNotificationStatusEnum.enumValues).toEqual([
      'DRAFT',
      'SCHEDULED',
      'SENDING',
      'SENT',
      'CANCELLED',
      'FAILED',
    ]);
    expect(worklogNotifications.scheduledAt.notNull).toBe(false);
    expect(worklogNotifications.inAppEnabled.notNull).toBe(true);
    expect(worklogNotifications.pushEnabled.notNull).toBe(true);
  });

  it('stores durable per-user read state and idempotent push delivery state', () => {
    expect(worklogNotificationDeliveryStatusEnum.enumValues).toEqual([
      'PENDING',
      'SENT',
      'FAILED',
      'SKIPPED',
    ]);
    expect(worklogNotificationRecipients.notificationId.notNull).toBe(true);
    expect(worklogNotificationRecipients.userId.notNull).toBe(true);
    expect(worklogNotificationRecipients.readAt.notNull).toBe(false);
    expect(worklogNotificationRecipients.pushStatus.notNull).toBe(true);
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