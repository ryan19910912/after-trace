import { describe, expect, it } from 'vitest';
import {
  accountProfileFromApi,
  notificationCategoryLabel,
  notificationCenterFromApi,
  safeNotificationHref,
} from './account-notification-api';

describe('account + notification Web client contract', () => {
  it('keeps the provider-neutral public account id as the customer support identifier', () => {
    expect(accountProfileFromApi({ displayName: 'Ryan', publicAccountId: 'AT-7K4M2P9Q3DX' })).toEqual({
      displayName: 'Ryan',
      publicAccountId: 'AT-7K4M2P9Q3DX',
    });
  });

  it('allows accounts without a provider display-name snapshot', () => {
    expect(accountProfileFromApi({ displayName: null, publicAccountId: 'AT-9RM8Q4K2W7P' })).toEqual({
      displayName: null,
      publicAccountId: 'AT-9RM8Q4K2W7P',
    });
  });

  it('maps the durable notification center without collapsing category into delivery channel', () => {
    expect(notificationCenterFromApi({
      unreadCount: 1,
      items: [{
        id: 12,
        category: 'SYSTEM',
        title: '方案已啟用',
        body: 'AI Pro 已生效。',
        deepLink: '/subscription',
        createdAt: '2026-09-07T04:00:00.000Z',
        sentAt: '2026-09-07T04:00:01.000Z',
        readAt: null,
      }],
    })).toMatchObject({
      unreadCount: 1,
      items: [{ id: 12, category: 'SYSTEM', readAt: null }],
    });
  });

  it('uses the three accepted customer category labels', () => {
    expect(notificationCategoryLabel('ANNOUNCEMENT')).toBe('公告通知');
    expect(notificationCategoryLabel('SYSTEM')).toBe('系統通知');
    expect(notificationCategoryLabel('TASK')).toBe('待辦通知');
  });

  it('only allows same-product relative notification deep links', () => {
    expect(safeNotificationHref('/subscription?from=notification#plan')).toBe('/subscription?from=notification#plan');
    expect(safeNotificationHref('https://example.com/phish')).toBeNull();
    expect(safeNotificationHref('//example.com/phish')).toBeNull();
    expect(safeNotificationHref('javascript:alert(1)')).toBeNull();
  });
});
