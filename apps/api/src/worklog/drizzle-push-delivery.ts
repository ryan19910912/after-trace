import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  PushDeliveryCandidate,
  PushDeliveryRepository,
  PushDeliverySubscription,
} from './push-delivery';

type ClaimedRow = {
  recipient_id: string | number;
  notification_id: string | number;
  user_id: string | number;
  category: PushDeliveryCandidate['category'];
  title: string;
  body: string;
  deep_link: string | null;
  attempt_count: string | number;
  announcement_push_enabled: boolean | null;
  system_push_enabled: boolean | null;
  task_push_enabled: boolean | null;
  subscriptions: unknown;
};

type SubscriptionJson = {
  id?: unknown;
  endpoint?: unknown;
  p256dh?: unknown;
  auth?: unknown;
};

export class DrizzlePushDeliveryRepository implements PushDeliveryRepository {
  constructor(private readonly db: Database) {}

  async claimPending(limit: number, staleBefore: Date): Promise<PushDeliveryCandidate[]> {
    const result = await this.db.execute(sql`
      WITH candidate_ids AS MATERIALIZED (
        SELECT recipient.id
        FROM worklog_notification_recipients AS recipient
        INNER JOIN worklog_notifications AS notification
          ON notification.id = recipient.notification_id
        WHERE recipient.push_status = 'PENDING'
          AND notification.status = 'SENT'
          AND notification.push_enabled = TRUE
          AND (recipient.push_next_attempt_at IS NULL OR recipient.push_next_attempt_at <= NOW())
          AND (recipient.push_attempted_at IS NULL OR recipient.push_attempted_at <= ${staleBefore})
        ORDER BY recipient.created_at ASC, recipient.id ASC
        FOR UPDATE OF recipient SKIP LOCKED
        LIMIT ${limit}
      ), claimed AS MATERIALIZED (
        UPDATE worklog_notification_recipients AS recipient
        SET push_attempt_count = recipient.push_attempt_count + 1,
            push_attempted_at = NOW(),
            push_next_attempt_at = NULL,
            push_failure_code = NULL,
            updated_at = NOW()
        FROM candidate_ids
        WHERE recipient.id = candidate_ids.id
          AND recipient.push_status = 'PENDING'
        RETURNING recipient.id,
                  recipient.notification_id,
                  recipient.user_id,
                  recipient.push_attempt_count
      )
      SELECT claimed.id::text AS recipient_id,
             claimed.notification_id::text AS notification_id,
             claimed.user_id::text AS user_id,
             claimed.push_attempt_count AS attempt_count,
             notification.type AS category,
             notification.title,
             notification.body,
             notification.deep_link,
             preference.announcement_push_enabled,
             preference.system_push_enabled,
             preference.task_push_enabled,
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'id', subscription.id,
                   'endpoint', subscription.endpoint,
                   'p256dh', subscription.p256dh,
                   'auth', subscription.auth
                 )
                 ORDER BY subscription.id
               ) FILTER (WHERE subscription.id IS NOT NULL),
               '[]'::jsonb
             ) AS subscriptions
      FROM claimed
      INNER JOIN worklog_notifications AS notification
        ON notification.id = claimed.notification_id
      LEFT JOIN worklog_notification_preferences AS preference
        ON preference.user_id = claimed.user_id
      LEFT JOIN worklog_push_subscriptions AS subscription
        ON subscription.user_id = claimed.user_id
       AND subscription.revoked_at IS NULL
      GROUP BY claimed.id,
               claimed.notification_id,
               claimed.user_id,
               claimed.push_attempt_count,
               notification.type,
               notification.title,
               notification.body,
               notification.deep_link,
               preference.announcement_push_enabled,
               preference.system_push_enabled,
               preference.task_push_enabled
      ORDER BY claimed.id ASC
    `);
    return (result.rows as ClaimedRow[]).map(candidateFromRow);
  }

  async recordSubscriptionSuccess(subscriptionId: number, userId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_push_subscriptions AS subscription
      SET last_success_at = NOW(),
          updated_at = NOW()
      WHERE subscription.id = ${subscriptionId}
        AND subscription.user_id = ${userId}
    `);
  }

  async revokeSubscription(subscriptionId: number, userId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_push_subscriptions AS subscription
      SET revoked_at = COALESCE(subscription.revoked_at, NOW()),
          updated_at = NOW()
      WHERE subscription.id = ${subscriptionId}
        AND subscription.user_id = ${userId}
    `);
  }

  async markSent(recipientId: number, attemptCount: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_notification_recipients AS recipient
      SET push_status = 'SENT',
          push_sent_at = COALESCE(recipient.push_sent_at, NOW()),
          push_next_attempt_at = NULL,
          push_failure_code = NULL,
          updated_at = NOW()
      WHERE recipient.id = ${recipientId}
        AND recipient.push_status = 'PENDING'
        AND recipient.push_attempt_count = ${attemptCount}
      RETURNING recipient.id
    `);
    return Boolean(result.rows[0]);
  }

  async markSkipped(recipientId: number, attemptCount: number, code: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_notification_recipients AS recipient
      SET push_status = 'SKIPPED',
          push_next_attempt_at = NULL,
          push_failure_code = ${failureCode(code)},
          updated_at = NOW()
      WHERE recipient.id = ${recipientId}
        AND recipient.push_status = 'PENDING'
        AND recipient.push_attempt_count = ${attemptCount}
      RETURNING recipient.id
    `);
    return Boolean(result.rows[0]);
  }

  async markFailed(recipientId: number, attemptCount: number, code: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_notification_recipients AS recipient
      SET push_status = 'FAILED',
          push_next_attempt_at = NULL,
          push_failure_code = ${failureCode(code)},
          updated_at = NOW()
      WHERE recipient.id = ${recipientId}
        AND recipient.push_status = 'PENDING'
        AND recipient.push_attempt_count = ${attemptCount}
      RETURNING recipient.id
    `);
    return Boolean(result.rows[0]);
  }

  async reschedule(
    recipientId: number,
    attemptCount: number,
    code: string,
    retryAt: Date,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_notification_recipients AS recipient
      SET push_next_attempt_at = ${retryAt},
          push_failure_code = ${failureCode(code)},
          updated_at = NOW()
      WHERE recipient.id = ${recipientId}
        AND recipient.push_status = 'PENDING'
        AND recipient.push_attempt_count = ${attemptCount}
      RETURNING recipient.id
    `);
    return Boolean(result.rows[0]);
  }
}

function candidateFromRow(row: ClaimedRow): PushDeliveryCandidate {
  const category = row.category;
  const preferenceEnabled = category === 'ANNOUNCEMENT'
    ? row.announcement_push_enabled ?? true
    : category === 'SYSTEM'
      ? row.system_push_enabled ?? true
      : row.task_push_enabled ?? true;
  return {
    recipientId: positiveNumber(row.recipient_id, 'INVALID_PUSH_RECIPIENT_ID'),
    notificationId: positiveNumber(row.notification_id, 'INVALID_NOTIFICATION_ID'),
    userId: positiveNumber(row.user_id, 'INVALID_USER_ID'),
    category,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    attemptCount: positiveNumber(row.attempt_count, 'INVALID_PUSH_ATTEMPT_COUNT'),
    preferenceEnabled,
    subscriptions: subscriptionList(row.subscriptions),
  };
}

function subscriptionList(value: unknown): PushDeliverySubscription[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new Error('INVALID_PUSH_SUBSCRIPTION_STATE');
    }
  }
  if (!Array.isArray(parsed)) throw new Error('INVALID_PUSH_SUBSCRIPTION_STATE');
  return parsed.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('INVALID_PUSH_SUBSCRIPTION_STATE');
    const row = item as SubscriptionJson;
    const endpoint = text(row.endpoint);
    const p256dh = text(row.p256dh);
    const auth = text(row.auth);
    if (!endpoint || !p256dh || !auth) throw new Error('INVALID_PUSH_SUBSCRIPTION_STATE');
    return {
      id: positiveNumber(row.id, 'INVALID_PUSH_SUBSCRIPTION_ID'),
      endpoint,
      p256dh,
      auth,
    };
  });
}

function positiveNumber(value: unknown, error: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(error);
  return parsed;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function failureCode(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Z0-9_]+$/.test(normalized) && normalized.length <= 128
    ? normalized
    : 'PUSH_DELIVERY_FAILED';
}
