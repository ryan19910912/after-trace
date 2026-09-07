export type PushPreferences = {
  announcementPushEnabled: boolean;
  systemPushEnabled: boolean;
  taskPushEnabled: boolean;
};

export type PushState = {
  activeSubscriptionCount: number;
  preferences: PushPreferences;
};

export type PushSubscriptionRegistration = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  platform?: string | null;
};

export type PushPreferencePatch = Partial<PushPreferences>;

export interface PushNotificationRepository {
  state(userId: number): Promise<PushState>;
  upsertSubscription(userId: number, input: PushSubscriptionRegistration): Promise<void>;
  revokeSubscription(userId: number, endpoint: string): Promise<boolean>;
  updatePreferences(userId: number, patch: PushPreferencePatch): Promise<PushPreferences>;
}

export class PushNotificationService {
  constructor(private readonly repository: PushNotificationRepository) {}

  state(userId: number): Promise<PushState> {
    assertUserId(userId);
    return this.repository.state(userId);
  }

  async registerSubscription(userId: number, input: PushSubscriptionRegistration): Promise<PushState> {
    assertUserId(userId);
    const normalized = normalizeSubscription(input);
    await this.repository.upsertSubscription(userId, normalized);
    return this.repository.state(userId);
  }

  async revokeSubscription(userId: number, endpoint: string): Promise<PushState> {
    assertUserId(userId);
    await this.repository.revokeSubscription(userId, pushEndpoint(endpoint));
    return this.repository.state(userId);
  }

  async updatePreferences(userId: number, patch: PushPreferencePatch): Promise<PushPreferences> {
    assertUserId(userId);
    const normalized = normalizePreferencePatch(patch);
    return this.repository.updatePreferences(userId, normalized);
  }
}

export function normalizeSubscription(input: PushSubscriptionRegistration): PushSubscriptionRegistration {
  return {
    endpoint: pushEndpoint(input.endpoint),
    p256dh: requiredToken(input.p256dh, 1024, 'INVALID_PUSH_P256DH'),
    auth: requiredToken(input.auth, 512, 'INVALID_PUSH_AUTH'),
    userAgent: optionalText(input.userAgent, 1000),
    platform: optionalText(input.platform, 64),
  };
}

export function normalizePreferencePatch(patch: PushPreferencePatch): PushPreferencePatch {
  const allowed: PushPreferencePatch = {};
  if (patch.announcementPushEnabled !== undefined) {
    if (typeof patch.announcementPushEnabled !== 'boolean') throw new Error('INVALID_PUSH_PREFERENCE');
    allowed.announcementPushEnabled = patch.announcementPushEnabled;
  }
  if (patch.systemPushEnabled !== undefined) {
    if (typeof patch.systemPushEnabled !== 'boolean') throw new Error('INVALID_PUSH_PREFERENCE');
    allowed.systemPushEnabled = patch.systemPushEnabled;
  }
  if (patch.taskPushEnabled !== undefined) {
    if (typeof patch.taskPushEnabled !== 'boolean') throw new Error('INVALID_PUSH_PREFERENCE');
    allowed.taskPushEnabled = patch.taskPushEnabled;
  }
  if (Object.keys(allowed).length === 0) throw new Error('PUSH_PREFERENCE_REQUIRED');
  return allowed;
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID_USER_ID');
}

function pushEndpoint(value: string): string {
  const endpoint = requiredToken(value, 4096, 'INVALID_PUSH_ENDPOINT');
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('INVALID_PUSH_ENDPOINT');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('INVALID_PUSH_ENDPOINT');
  return endpoint;
}

function requiredToken(value: string, max: number, error: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (normalized.length > max) throw new Error('INVALID_PUSH_METADATA');
  return normalized;
}
