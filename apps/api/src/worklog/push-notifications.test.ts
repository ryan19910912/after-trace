import { describe, expect, it } from 'vitest';
import {
  PushNotificationService,
  normalizePreferencePatch,
  normalizeSubscription,
  type PushNotificationRepository,
  type PushPreferences,
  type PushState,
} from './push-notifications';

function repository(overrides: Partial<PushNotificationRepository> = {}): PushNotificationRepository {
  const preferences: PushPreferences = {
    announcementPushEnabled: true,
    systemPushEnabled: true,
    taskPushEnabled: true,
  };
  return {
    async state(): Promise<PushState> { return { activeSubscriptionCount: 0, preferences }; },
    async upsertSubscription() {},
    async revokeSubscription() { return false; },
    async updatePreferences() { return preferences; },
    ...overrides,
  };
}

describe('push notification domain', () => {
  it('accepts only bounded HTTPS push endpoints', () => {
    expect(normalizeSubscription({
      endpoint: 'https://push.example.test/send/abc',
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    })).toMatchObject({ endpoint: 'https://push.example.test/send/abc' });
    expect(() => normalizeSubscription({
      endpoint: 'http://push.example.test/send/abc',
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    })).toThrowError('INVALID_PUSH_ENDPOINT');
  });

  it('requires an explicit preference field rather than accepting an empty patch', () => {
    expect(() => normalizePreferencePatch({})).toThrowError('PUSH_PREFERENCE_REQUIRED');
    expect(normalizePreferencePatch({ taskPushEnabled: false })).toEqual({ taskPushEnabled: false });
  });

  it('registers against the authenticated AFTERTRACE user and returns durable state', async () => {
    let registeredUserId = 0;
    const service = new PushNotificationService(repository({
      async upsertSubscription(userId) { registeredUserId = userId; },
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
    }));

    const state = await service.registerSubscription(42, {
      endpoint: 'https://push.example.test/send/abc',
      p256dh: 'key',
      auth: 'secret',
    });

    expect(registeredUserId).toBe(42);
    expect(state.activeSubscriptionCount).toBe(1);
  });
});
