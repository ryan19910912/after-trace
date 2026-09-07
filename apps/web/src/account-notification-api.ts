export type AccountProfile = {
  displayName: string | null;
  publicAccountId: string;
};

export type NotificationCategory = 'ANNOUNCEMENT' | 'SYSTEM' | 'TASK';

export type NotificationCenterItem = {
  id: number;
  category: NotificationCategory;
  title: string;
  body: string;
  deepLink: string | null;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
};

export type NotificationCenter = {
  items: NotificationCenterItem[];
  unreadCount: number;
};

export type PushPreferences = {
  announcementPushEnabled: boolean;
  systemPushEnabled: boolean;
  taskPushEnabled: boolean;
};

export type PushState = {
  serverPushEnabled: boolean;
  publicKey: string | null;
  activeSubscriptionCount: number;
  preferences: PushPreferences;
};

export type PushSubscriptionRegistration = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
  platform?: string | null;
};

type ApiErrorBody = { error?: string };

export class AccountNotificationApi {
  constructor(private readonly baseUrl: string) {}

  async profile(sessionToken: string): Promise<AccountProfile> {
    const body = await requestJson<{ profile: unknown }>(
      this.request(sessionToken, '/api/v1/account/profile'),
      '帳號資料載入失敗',
    );
    return accountProfileFromApi(body.profile);
  }

  async notifications(sessionToken: string, limit = 50): Promise<NotificationCenter> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 100 ? limit : 50;
    const body = await requestJson<{ items: unknown; unreadCount: unknown }>(
      this.request(sessionToken, `/api/v1/notifications?limit=${safeLimit}`),
      '通知載入失敗',
    );
    return notificationCenterFromApi(body);
  }

  async markNotificationRead(sessionToken: string, notificationId: number): Promise<string> {
    const body = await requestJson<{ readAt: unknown }>(
      this.request(sessionToken, `/api/v1/notifications/${notificationId}/read`, { method: 'PATCH' }),
      '通知已讀狀態更新失敗',
    );
    const readAt = nullableString(body.readAt);
    if (!readAt) throw new Error('INVALID_NOTIFICATION_RESPONSE');
    return readAt;
  }

  async markAllNotificationsRead(sessionToken: string): Promise<number> {
    const body = await requestJson<{ updatedCount: unknown }>(
      this.request(sessionToken, '/api/v1/notifications/read-all', { method: 'POST' }),
      '通知已讀狀態更新失敗',
    );
    const count = Number(body.updatedCount);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  async pushState(sessionToken: string): Promise<PushState> {
    const body = await requestJson<unknown>(
      this.request(sessionToken, '/api/v1/notifications/push'),
      '通知設定載入失敗',
    );
    return pushStateFromApi(body);
  }

  async registerPushSubscription(sessionToken: string, input: PushSubscriptionRegistration): Promise<PushState> {
    const body = await requestJson<unknown>(
      this.request(sessionToken, '/api/v1/notifications/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
      '推播啟用失敗',
    );
    return pushStateFromApi(body);
  }

  async revokePushSubscription(sessionToken: string, endpoint: string): Promise<PushState> {
    const body = await requestJson<unknown>(
      this.request(sessionToken, '/api/v1/notifications/push/subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }),
      '推播停用失敗',
    );
    return pushStateFromApi(body);
  }

  async updatePushPreferences(sessionToken: string, patch: Partial<PushPreferences>): Promise<PushPreferences> {
    const body = await requestJson<{ preferences?: unknown }>(
      this.request(sessionToken, '/api/v1/notifications/push/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
      '推播偏好更新失敗',
    );
    return pushPreferencesFromApi(body.preferences);
  }

  private request(sessionToken: string, path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers });
  }
}

export function accountProfileFromApi(raw: unknown): AccountProfile {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_ACCOUNT_PROFILE');
  const value = raw as Record<string, unknown>;
  const publicAccountId = requiredString(value.publicAccountId);
  if (!publicAccountId) throw new Error('INVALID_ACCOUNT_PROFILE');
  return { displayName: nullableString(value.displayName), publicAccountId };
}

export function notificationCenterFromApi(raw: unknown): NotificationCenter {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_NOTIFICATION_RESPONSE');
  const value = raw as Record<string, unknown>;
  const items = Array.isArray(value.items) ? value.items.map(notificationItemFromApi) : [];
  const unreadCount = Number(value.unreadCount);
  return {
    items,
    unreadCount: Number.isSafeInteger(unreadCount) && unreadCount >= 0
      ? unreadCount
      : items.filter((item) => !item.readAt).length,
  };
}

export function pushStateFromApi(raw: unknown): PushState {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_PUSH_RESPONSE');
  const value = raw as Record<string, unknown>;
  const activeSubscriptionCount = Number(value.activeSubscriptionCount);
  return {
    serverPushEnabled: value.serverPushEnabled === true,
    publicKey: nullableString(value.publicKey),
    activeSubscriptionCount: Number.isSafeInteger(activeSubscriptionCount) && activeSubscriptionCount >= 0
      ? activeSubscriptionCount
      : 0,
    preferences: pushPreferencesFromApi(value.preferences),
  };
}

export function pushPreferencesFromApi(raw: unknown): PushPreferences {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_PUSH_RESPONSE');
  const value = raw as Record<string, unknown>;
  if (
    typeof value.announcementPushEnabled !== 'boolean'
    || typeof value.systemPushEnabled !== 'boolean'
    || typeof value.taskPushEnabled !== 'boolean'
  ) {
    throw new Error('INVALID_PUSH_RESPONSE');
  }
  return {
    announcementPushEnabled: value.announcementPushEnabled,
    systemPushEnabled: value.systemPushEnabled,
    taskPushEnabled: value.taskPushEnabled,
  };
}

export function notificationCategoryLabel(category: NotificationCategory): string {
  switch (category) {
    case 'ANNOUNCEMENT': return '公告通知';
    case 'SYSTEM': return '系統通知';
    case 'TASK': return '待辦通知';
  }
}

export function safeNotificationHref(value: string | null): string | null {
  const raw = value?.trim() ?? '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const base = new URL('https://aftertrace.invalid/');
    const parsed = new URL(raw, base);
    if (parsed.origin !== base.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function notificationItemFromApi(raw: unknown): NotificationCenterItem {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_NOTIFICATION_RESPONSE');
  const value = raw as Record<string, unknown>;
  const id = Number(value.id);
  const category = String(value.category) as NotificationCategory;
  const title = requiredString(value.title);
  const body = requiredString(value.body);
  const createdAt = requiredString(value.createdAt);
  if (!Number.isSafeInteger(id) || id <= 0 || !isNotificationCategory(category) || !title || !body || !createdAt) {
    throw new Error('INVALID_NOTIFICATION_RESPONSE');
  }
  return {
    id,
    category,
    title,
    body,
    deepLink: nullableString(value.deepLink),
    createdAt,
    sentAt: nullableString(value.sentAt),
    readAt: nullableString(value.readAt),
  };
}

function isNotificationCategory(value: string): value is NotificationCategory {
  return value === 'ANNOUNCEMENT' || value === 'SYSTEM' || value === 'TASK';
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function requestJson<T>(responsePromise: Promise<Response>, fallback: string): Promise<T & ApiErrorBody> {
  const response = await responsePromise;
  const text = await response.text();
  let body: T & ApiErrorBody;
  try {
    body = text ? JSON.parse(text) as T & ApiErrorBody : {} as T & ApiErrorBody;
  } catch {
    throw new Error(`${fallback} (${response.status})`);
  }
  if (!response.ok) throw new Error(body.error || `${fallback} (${response.status})`);
  return body;
}
