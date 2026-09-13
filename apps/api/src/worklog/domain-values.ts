export const WORKLOG_AUTH_PROVIDERS = ['GOOGLE', 'LINE', 'APPLE'] as const;
export type WorklogAuthProvider = (typeof WORKLOG_AUTH_PROVIDERS)[number];

export const WORKLOG_SOURCE_MEMBER_ROLES = ['OWNER', 'MEMBER'] as const;
export type WorklogSourceMemberRole = (typeof WORKLOG_SOURCE_MEMBER_ROLES)[number];

export const WORKLOG_PLAN_TYPES = ['FREE', 'SUBSCRIPTION'] as const;
export type WorklogPlanType = (typeof WORKLOG_PLAN_TYPES)[number];

export const WORKLOG_NOTIFICATION_TYPES = ['ANNOUNCEMENT', 'SYSTEM', 'TASK'] as const;
export type WorklogNotificationType = (typeof WORKLOG_NOTIFICATION_TYPES)[number];

export const WORKLOG_NOTIFICATION_AUDIENCES = [
  'ALL_USERS',
  'FREE_USERS',
  'AI_SUBSCRIBERS',
  'SPECIFIC_USERS',
] as const;
export type WorklogNotificationAudience = (typeof WORKLOG_NOTIFICATION_AUDIENCES)[number];

export const WORKLOG_NOTIFICATION_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELLED',
  'FAILED',
] as const;
export type WorklogNotificationStatus = (typeof WORKLOG_NOTIFICATION_STATUSES)[number];

export const WORKLOG_NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type WorklogNotificationDeliveryStatus = (typeof WORKLOG_NOTIFICATION_DELIVERY_STATUSES)[number];

export const WORKLOG_RECORD_AI_ENRICHMENT_STATUSES = ['NONE', 'ENRICHED'] as const;
export type WorklogRecordAiEnrichmentStatus = (typeof WORKLOG_RECORD_AI_ENRICHMENT_STATUSES)[number];

export const WORKLOG_RECORD_REVISION_CHANNELS = [
  'PWA_MANUAL',
  'PWA_DELETE',
  'PWA_RESTORE',
  'AI_REWRITE',
  'SYSTEM',
] as const;
export type WorklogRecordRevisionChannel = (typeof WORKLOG_RECORD_REVISION_CHANNELS)[number];

export function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
