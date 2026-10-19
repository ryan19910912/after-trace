import type {
  AdminAnnouncementAudience,
  AdminAnnouncementInput,
  AdminAnnouncementMode,
  AdminAnnouncementSummary,
  AdminAnnouncementUserOption,
} from './announcement-api';

export type AnnouncementFormState = {
  title: string;
  body: string;
  audience: AdminAnnouncementAudience;
  selectedUsers: AdminAnnouncementUserOption[];
  inAppEnabled: boolean;
  pushEnabled: boolean;
  deepLink: string;
  mode: AdminAnnouncementMode;
  scheduledLocal: string;
};

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementFormState = {
  title: '',
  body: '',
  audience: 'ALL_USERS',
  selectedUsers: [],
  inAppEnabled: true,
  pushEnabled: false,
  deepLink: '',
  mode: 'DRAFT',
  scheduledLocal: '',
};

export function toAnnouncementInput(state: AnnouncementFormState): AdminAnnouncementInput {
  const title = state.title.trim();
  const body = state.body.trim();
  if (!title || title.length > 255) throw new Error('INVALID_NOTIFICATION_TITLE');
  if (!body || body.length > 10_000) throw new Error('INVALID_NOTIFICATION_BODY');
  if (!state.inAppEnabled && !state.pushEnabled) throw new Error('NOTIFICATION_CHANNEL_REQUIRED');

  const specificUserIds = state.audience === 'SPECIFIC_USERS'
    ? uniquePositiveIds(state.selectedUsers.map((user) => user.id))
    : [];
  if (state.audience === 'SPECIFIC_USERS' && specificUserIds.length === 0) {
    throw new Error('SPECIFIC_USERS_REQUIRED');
  }

  const scheduledAt = state.mode === 'SCHEDULED' ? localInputToIso(state.scheduledLocal) : null;
  if (state.mode === 'SCHEDULED' && !scheduledAt) throw new Error('INVALID_SCHEDULED_AT');

  return {
    title,
    body,
    audience: state.audience,
    specificUserIds,
    inAppEnabled: state.inAppEnabled,
    pushEnabled: state.pushEnabled,
    deepLink: state.deepLink.trim() || null,
    mode: state.mode,
    scheduledAt,
  };
}

export function localInputToIso(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function canSendAnnouncement(announcement: AdminAnnouncementSummary): boolean {
  return announcement.status === 'DRAFT' || announcement.status === 'SCHEDULED';
}

export function canCancelAnnouncement(announcement: AdminAnnouncementSummary): boolean {
  return announcement.status === 'DRAFT' || announcement.status === 'SCHEDULED';
}

export function announcementAudienceLabel(value: AdminAnnouncementAudience): string {
  if (value === 'ALL_USERS') return '全部使用者';
  if (value === 'FREE_USERS') return 'FREE 使用者';
  if (value === 'AI_SUBSCRIBERS') return 'AI Pro 訂閱者';
  return '指定使用者';
}

export function announcementStatusLabel(value: AdminAnnouncementSummary['status']): string {
  if (value === 'DRAFT') return '草稿';
  if (value === 'SCHEDULED') return '已排程';
  if (value === 'SENDING') return '發送中';
  if (value === 'SENT') return '已送出';
  if (value === 'CANCELLED') return '已取消';
  return '失敗';
}

export function announcementModeLabel(value: AdminAnnouncementMode): string {
  if (value === 'DRAFT') return '儲存草稿';
  if (value === 'SEND_NOW') return '立即送出';
  return '排程送出';
}

function uniquePositiveIds(values: number[]): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_SPECIFIC_USER_ID');
    ids.add(value);
  }
  return [...ids];
}
