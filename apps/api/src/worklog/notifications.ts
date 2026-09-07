export type NotificationCategory = 'ANNOUNCEMENT' | 'SYSTEM' | 'TASK';
export type NotificationStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
export type NotificationAudience = 'ALL_USERS' | 'FREE_USERS' | 'AI_SUBSCRIBERS' | 'SPECIFIC_USERS';

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

export type NotificationCenterPage = {
  items: NotificationCenterItem[];
  unreadCount: number;
};

export type SystemNotificationInput = {
  eventKey: string;
  userId: number;
  title: string;
  body: string;
  deepLink?: string | null;
  referenceType?: string | null;
  referenceId?: number | null;
  metadata?: Record<string, unknown> | null;
  pushEnabled?: boolean;
};

export type SystemNotificationResult = {
  notificationId: number;
  idempotent: boolean;
};

export type AdminAnnouncementInput = {
  title: string;
  body: string;
  audience: NotificationAudience;
  specificUserIds: number[];
  inAppEnabled: boolean;
  pushEnabled: boolean;
  deepLink?: string | null;
  scheduledAt?: Date | null;
  createdByActor: string;
};

export type AdminAnnouncementSummary = {
  id: number;
  status: NotificationStatus;
  audience: NotificationAudience;
  title: string;
  body: string;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  deepLink: string | null;
  scheduledAt: string | null;
  dispatchStartedAt: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  createdByActor: string | null;
  createdAt: string;
  updatedAt: string;
  recipientCount: number;
  unreadCount: number;
  pushSentCount: number;
  pushFailedCount: number;
};

export type AnnouncementCreateResult = {
  announcement: AdminAnnouncementSummary;
};

export type AnnouncementDispatchResult =
  | { status: 'SENT'; announcement: AdminAnnouncementSummary }
  | { status: 'NOT_FOUND' | 'NOT_DISPATCHABLE' };

export type AnnouncementCancelResult =
  | { status: 'CANCELLED'; announcement: AdminAnnouncementSummary }
  | { status: 'NOT_FOUND' | 'NOT_CANCELLABLE' };

export interface NotificationRepository {
  listForUser(userId: number, limit: number): Promise<NotificationCenterPage>;
  markRead(userId: number, notificationId: number): Promise<string | null>;
  markAllRead(userId: number): Promise<number>;
  createSystemNotification(input: SystemNotificationInput): Promise<SystemNotificationResult>;
  createAnnouncement(input: AdminAnnouncementInput): Promise<AnnouncementCreateResult>;
  dispatchAnnouncement(notificationId: number): Promise<AnnouncementDispatchResult>;
  cancelAnnouncement(notificationId: number, actor: string): Promise<AnnouncementCancelResult>;
  listAnnouncements(limit: number): Promise<AdminAnnouncementSummary[]>;
  announcementDetail(notificationId: number): Promise<AdminAnnouncementSummary | null>;
}

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  notificationCenter(userId: number, limit = 50): Promise<NotificationCenterPage> {
    return this.repository.listForUser(userId, boundedLimit(limit));
  }

  markRead(userId: number, notificationId: number): Promise<string | null> {
    return this.repository.markRead(userId, notificationId);
  }

  markAllRead(userId: number): Promise<number> {
    return this.repository.markAllRead(userId);
  }

  createSystemNotification(input: SystemNotificationInput): Promise<SystemNotificationResult> {
    // Persistence scopes the key as `user:<id>:<eventKey>` before writing into varchar(255).
    // Keep the caller-controlled suffix bounded so a large numeric user id cannot overflow it.
    const eventKey = requiredText(input.eventKey, 200, 'INVALID_SYSTEM_EVENT_KEY');
    const title = requiredText(input.title, 255, 'INVALID_NOTIFICATION_TITLE');
    const body = requiredText(input.body, 10_000, 'INVALID_NOTIFICATION_BODY');
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0) throw new Error('INVALID_USER_ID');
    return this.repository.createSystemNotification({
      ...input,
      eventKey,
      title,
      body,
      deepLink: optionalText(input.deepLink, 2_000),
      referenceType: optionalText(input.referenceType, 64),
      referenceId: validOptionalId(input.referenceId),
      pushEnabled: input.pushEnabled ?? true,
    });
  }

  createAnnouncement(input: AdminAnnouncementInput): Promise<AnnouncementCreateResult> {
    const title = requiredText(input.title, 255, 'INVALID_NOTIFICATION_TITLE');
    const body = requiredText(input.body, 10_000, 'INVALID_NOTIFICATION_BODY');
    if (!input.inAppEnabled && !input.pushEnabled) throw new Error('NOTIFICATION_CHANNEL_REQUIRED');
    const specificUserIds = uniquePositiveIds(input.specificUserIds);
    if (input.audience === 'SPECIFIC_USERS' && specificUserIds.length === 0) {
      throw new Error('SPECIFIC_USERS_REQUIRED');
    }
    if (input.audience !== 'SPECIFIC_USERS' && specificUserIds.length > 0) {
      throw new Error('SPECIFIC_USERS_NOT_ALLOWED');
    }
    return this.repository.createAnnouncement({
      ...input,
      title,
      body,
      specificUserIds,
      deepLink: optionalText(input.deepLink, 2_000),
    });
  }

  dispatchAnnouncement(notificationId: number): Promise<AnnouncementDispatchResult> {
    return this.repository.dispatchAnnouncement(notificationId);
  }

  cancelAnnouncement(notificationId: number, actor: string): Promise<AnnouncementCancelResult> {
    return this.repository.cancelAnnouncement(notificationId, requiredText(actor, 128, 'INVALID_ADMIN_ACTOR'));
  }

  listAnnouncements(limit = 100): Promise<AdminAnnouncementSummary[]> {
    return this.repository.listAnnouncements(boundedLimit(limit, 200));
  }

  announcementDetail(notificationId: number): Promise<AdminAnnouncementSummary | null> {
    return this.repository.announcementDetail(notificationId);
  }
}

function requiredText(value: string, max: number, error: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > max) throw new Error('INVALID_NOTIFICATION_TEXT');
  return normalized;
}

function validOptionalId(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_REFERENCE_ID');
  return value;
}

function uniquePositiveIds(values: number[]): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_SPECIFIC_USER_ID');
    ids.add(value);
  }
  return [...ids];
}

function boundedLimit(value: number, max = 100): number {
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : Math.min(50, max);
}
