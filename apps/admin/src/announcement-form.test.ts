import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANNOUNCEMENT_FORM,
  canCancelAnnouncement,
  canSendAnnouncement,
  toAnnouncementInput,
} from './announcement-form';
import type { AdminAnnouncementSummary } from './announcement-api';

describe('toAnnouncementInput', () => {
  it('never broadens an empty SPECIFIC_USERS audience into all users', () => {
    expect(() => toAnnouncementInput({
      ...EMPTY_ANNOUNCEMENT_FORM,
      title: '只給指定帳號',
      body: '測試',
      audience: 'SPECIFIC_USERS',
      selectedUsers: [],
    })).toThrowError('SPECIFIC_USERS_REQUIRED');
  });

  it('deduplicates explicit user ids and strips specific ids from broad audiences', () => {
    const users = [
      { id: 7, publicAccountId: 'AT-AAAA', displayName: 'A', planCode: 'FREE' },
      { id: 7, publicAccountId: 'AT-AAAA', displayName: 'A', planCode: 'FREE' },
      { id: 9, publicAccountId: 'AT-BBBB', displayName: 'B', planCode: 'AI_PRO' },
    ];
    expect(toAnnouncementInput({
      ...EMPTY_ANNOUNCEMENT_FORM,
      title: '指定',
      body: '內容',
      audience: 'SPECIFIC_USERS',
      selectedUsers: users,
    }).specificUserIds).toEqual([7, 9]);

    expect(toAnnouncementInput({
      ...EMPTY_ANNOUNCEMENT_FORM,
      title: '全部',
      body: '內容',
      audience: 'ALL_USERS',
      selectedUsers: users,
    }).specificUserIds).toEqual([]);
  });

  it('requires at least one delivery channel', () => {
    expect(() => toAnnouncementInput({
      ...EMPTY_ANNOUNCEMENT_FORM,
      title: '沒有管道',
      body: '內容',
      inAppEnabled: false,
      pushEnabled: false,
    })).toThrowError('NOTIFICATION_CHANNEL_REQUIRED');
  });

  it('converts a scheduled local value to an ISO timestamp', () => {
    const input = toAnnouncementInput({
      ...EMPTY_ANNOUNCEMENT_FORM,
      title: '排程',
      body: '內容',
      mode: 'SCHEDULED',
      scheduledLocal: '2026-09-08T09:30',
    });
    expect(input.mode).toBe('SCHEDULED');
    expect(input.scheduledAt).toMatch(/^2026-09-08T/);
  });
});

describe('announcement lifecycle actions', () => {
  const base: AdminAnnouncementSummary = {
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
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    recipientCount: 0,
    unreadCount: 0,
    pushSentCount: 0,
    pushFailedCount: 0,
  };

  it('only offers manual send/cancel before dispatch starts', () => {
    expect(canSendAnnouncement(base)).toBe(true);
    expect(canCancelAnnouncement(base)).toBe(true);
    expect(canSendAnnouncement({ ...base, status: 'SCHEDULED' })).toBe(true);
    expect(canCancelAnnouncement({ ...base, status: 'SCHEDULED' })).toBe(true);
    expect(canSendAnnouncement({ ...base, status: 'SENT' })).toBe(false);
    expect(canCancelAnnouncement({ ...base, status: 'SENDING' })).toBe(false);
  });
});
