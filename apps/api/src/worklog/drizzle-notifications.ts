import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  AdminAnnouncementInput,
  AdminAnnouncementSummary,
  AnnouncementCancelResult,
  AnnouncementCreateResult,
  AnnouncementDispatchResult,
  NotificationCenterItem,
  NotificationCenterPage,
  NotificationRepository,
  SystemNotificationInput,
  SystemNotificationResult,
} from './notifications';

type CenterRow = {
  id: string;
  category: NotificationCenterItem['category'];
  title: string;
  body: string;
  deep_link: string | null;
  created_at: Date | string;
  sent_at: Date | string | null;
  read_at: Date | string | null;
};

type AnnouncementRow = {
  id: string;
  status: AdminAnnouncementSummary['status'];
  audience: AdminAnnouncementSummary['audience'];
  title: string;
  body: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  deep_link: string | null;
  scheduled_at: Date | string | null;
  dispatch_started_at: Date | string | null;
  sent_at: Date | string | null;
  cancelled_at: Date | string | null;
  created_by_actor: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  recipient_count: string | number;
  unread_count: string | number;
  push_sent_count: string | number;
  push_failed_count: string | number;
};

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: number, limit: number): Promise<NotificationCenterPage> {
    const [itemsResult, unreadResult] = await Promise.all([
      this.db.execute(sql`
        SELECT notification.id::text AS id,
               notification.type AS category,
               notification.title,
               notification.body,
               notification.deep_link,
               notification.created_at,
               notification.sent_at,
               recipient.read_at
        FROM worklog_notification_recipients AS recipient
        INNER JOIN worklog_notifications AS notification ON notification.id = recipient.notification_id
        WHERE recipient.user_id = ${userId}
          AND notification.in_app_enabled = TRUE
          AND notification.status = 'SENT'
        ORDER BY recipient.created_at DESC, recipient.id DESC
        LIMIT ${limit}
      `),
      this.db.execute(sql`
        SELECT COUNT(*)::int AS unread_count
        FROM worklog_notification_recipients AS recipient
        INNER JOIN worklog_notifications AS notification ON notification.id = recipient.notification_id
        WHERE recipient.user_id = ${userId}
          AND recipient.read_at IS NULL
          AND notification.in_app_enabled = TRUE
          AND notification.status = 'SENT'
      `),
    ]);
    return {
      items: (itemsResult.rows as CenterRow[]).map(centerItem),
      unreadCount: Number((unreadResult.rows[0] as { unread_count?: number } | undefined)?.unread_count ?? 0),
    };
  }

  async markRead(userId: number, notificationId: number): Promise<string | null> {
    const result = await this.db.execute(sql`
      UPDATE worklog_notification_recipients AS recipient
      SET read_at = COALESCE(recipient.read_at, NOW()), updated_at = NOW()
      WHERE recipient.user_id = ${userId}
        AND recipient.notification_id = ${notificationId}
        AND EXISTS (
          SELECT 1 FROM worklog_notifications AS notification
          WHERE notification.id = recipient.notification_id
            AND notification.in_app_enabled = TRUE
            AND notification.status = 'SENT'
        )
      RETURNING recipient.read_at
    `);
    const row = result.rows[0] as { read_at?: Date | string | null } | undefined;
    return row?.read_at ? new Date(row.read_at).toISOString() : null;
  }

  async markAllRead(userId: number): Promise<number> {
    const result = await this.db.execute(sql`
      WITH updated_rows AS (
        UPDATE worklog_notification_recipients AS recipient
        SET read_at = NOW(), updated_at = NOW()
        WHERE recipient.user_id = ${userId}
          AND recipient.read_at IS NULL
          AND EXISTS (
            SELECT 1 FROM worklog_notifications AS notification
            WHERE notification.id = recipient.notification_id
              AND notification.in_app_enabled = TRUE
              AND notification.status = 'SENT'
          )
        RETURNING recipient.id
      )
      SELECT COUNT(*)::int AS updated_count FROM updated_rows
    `);
    return Number((result.rows[0] as { updated_count?: number } | undefined)?.updated_count ?? 0);
  }

  async createSystemNotification(input: SystemNotificationInput): Promise<SystemNotificationResult> {
    const durableEventKey = `user:${input.userId}:${input.eventKey}`;
    const result = await this.db.execute(sql`
      WITH inserted_notification AS (
        INSERT INTO worklog_notifications (
          type, status, audience, title, body,
          in_app_enabled, push_enabled, system_event_key,
          reference_type, reference_id, deep_link, metadata,
          created_by_actor, sent_at, created_at, updated_at
        )
        VALUES (
          'SYSTEM', 'SENT', 'SPECIFIC_USERS', ${input.title}, ${input.body},
          TRUE, ${input.pushEnabled ?? true}, ${durableEventKey},
          ${input.referenceType ?? null}, ${input.referenceId ?? null}, ${input.deepLink ?? null}, ${input.metadata ?? null},
          'SYSTEM', NOW(), NOW(), NOW()
        )
        ON CONFLICT (system_event_key) DO NOTHING
        RETURNING id
      ), selected_notification AS (
        SELECT inserted_notification.id, FALSE AS idempotent FROM inserted_notification
        UNION ALL
        SELECT notification.id, TRUE AS idempotent
        FROM worklog_notifications AS notification
        WHERE notification.system_event_key = ${durableEventKey}
          AND NOT EXISTS (SELECT 1 FROM inserted_notification)
        LIMIT 1
      ), inserted_recipient AS (
        INSERT INTO worklog_notification_recipients (
          notification_id, user_id, read_at, push_status, created_at, updated_at
        )
        SELECT selected_notification.id, ${input.userId}, NULL,
               CASE WHEN ${input.pushEnabled ?? true} THEN 'PENDING' ELSE 'SKIPPED' END,
               NOW(), NOW()
        FROM selected_notification
        ON CONFLICT (notification_id, user_id) DO NOTHING
        RETURNING id
      )
      SELECT selected_notification.id::text AS id, selected_notification.idempotent
      FROM selected_notification
      LIMIT 1
    `);
    const row = result.rows[0] as { id: string; idempotent: boolean } | undefined;
    if (!row) throw new Error('SYSTEM_NOTIFICATION_CREATE_FAILED');
    return { notificationId: Number(row.id), idempotent: Boolean(row.idempotent) };
  }

  async createAnnouncement(input: AdminAnnouncementInput): Promise<AnnouncementCreateResult> {
    const status = input.scheduledAt ? 'SCHEDULED' : 'DRAFT';
    const metadata = input.audience === 'SPECIFIC_USERS' ? { specificUserIds: input.specificUserIds } : null;
    const result = await this.db.execute(sql`
      INSERT INTO worklog_notifications (
        type, status, audience, title, body,
        in_app_enabled, push_enabled, deep_link, metadata,
        created_by_actor, scheduled_at, created_at, updated_at
      )
      VALUES (
        'ANNOUNCEMENT', ${status}, ${input.audience}, ${input.title}, ${input.body},
        ${input.inAppEnabled}, ${input.pushEnabled}, ${input.deepLink ?? null}, ${metadata},
        ${input.createdByActor}, ${input.scheduledAt ?? null}, NOW(), NOW()
      )
      RETURNING id::text AS id
    `);
    const id = Number((result.rows[0] as { id?: string } | undefined)?.id);
    const announcement = await this.announcementDetail(id);
    if (!announcement) throw new Error('ANNOUNCEMENT_CREATE_FAILED');
    return { announcement };
  }

  async dispatchAnnouncement(notificationId: number): Promise<AnnouncementDispatchResult> {
    const result = await this.db.execute(sql`
      WITH claimed AS MATERIALIZED (
        UPDATE worklog_notifications AS notification
        SET status = 'SENDING',
            dispatch_started_at = COALESCE(notification.dispatch_started_at, NOW()),
            updated_at = NOW()
        WHERE notification.id = ${notificationId}
          AND notification.type = 'ANNOUNCEMENT'
          AND notification.status IN ('DRAFT', 'SCHEDULED')
        RETURNING notification.id, notification.audience, notification.metadata, notification.push_enabled
      ), audience_users AS MATERIALIZED (
        SELECT account.id AS user_id
        FROM worklog_users AS account
        CROSS JOIN claimed
        WHERE claimed.audience = 'ALL_USERS'
           OR (
             claimed.audience = 'AI_SUBSCRIBERS'
             AND EXISTS (
               SELECT 1
               FROM worklog_user_subscriptions AS subscription
               INNER JOIN worklog_subscription_plans AS plan ON plan.code = subscription.plan_code
               WHERE subscription.user_id = account.id
                 AND subscription.status = 'ACTIVE'
                 AND subscription.effective_at <= NOW()
                 AND subscription.current_period_start <= NOW()
                 AND (subscription.current_period_end IS NULL OR subscription.current_period_end > NOW())
                 AND plan.enabled = TRUE
                 AND plan.ai_enabled = TRUE
             )
           )
           OR (
             claimed.audience = 'FREE_USERS'
             AND NOT EXISTS (
               SELECT 1
               FROM worklog_user_subscriptions AS subscription
               INNER JOIN worklog_subscription_plans AS plan ON plan.code = subscription.plan_code
               WHERE subscription.user_id = account.id
                 AND subscription.status = 'ACTIVE'
                 AND subscription.effective_at <= NOW()
                 AND subscription.current_period_start <= NOW()
                 AND (subscription.current_period_end IS NULL OR subscription.current_period_end > NOW())
                 AND plan.enabled = TRUE
                 AND plan.ai_enabled = TRUE
             )
           )
           OR (
             claimed.audience = 'SPECIFIC_USERS'
             AND account.id IN (
               SELECT value::bigint
               FROM jsonb_array_elements_text(COALESCE(claimed.metadata -> 'specificUserIds', '[]'::jsonb)) AS selected(value)
             )
           )
      ), inserted_recipients AS (
        INSERT INTO worklog_notification_recipients (
          notification_id, user_id, read_at, push_status, created_at, updated_at
        )
        SELECT claimed.id, audience_users.user_id, NULL,
               CASE WHEN claimed.push_enabled THEN 'PENDING' ELSE 'SKIPPED' END,
               NOW(), NOW()
        FROM claimed
        CROSS JOIN audience_users
        ON CONFLICT (notification_id, user_id) DO NOTHING
        RETURNING id
      ), finalized AS (
        UPDATE worklog_notifications AS notification
        SET status = 'SENT', sent_at = COALESCE(notification.sent_at, NOW()), updated_at = NOW()
        WHERE notification.id IN (SELECT claimed.id FROM claimed)
        RETURNING notification.id
      )
      SELECT finalized.id::text AS id FROM finalized LIMIT 1
    `);
    const id = Number((result.rows[0] as { id?: string } | undefined)?.id);
    if (id > 0) {
      const announcement = await this.announcementDetail(id);
      if (!announcement) throw new Error('ANNOUNCEMENT_DISPATCH_STATE_MISSING');
      return { status: 'SENT', announcement };
    }
    const existing = await this.announcementDetail(notificationId);
    return { status: existing ? 'NOT_DISPATCHABLE' : 'NOT_FOUND' };
  }

  async cancelAnnouncement(notificationId: number, actor: string): Promise<AnnouncementCancelResult> {
    const result = await this.db.execute(sql`
      UPDATE worklog_notifications AS notification
      SET status = 'CANCELLED',
          cancelled_at = NOW(),
          metadata = COALESCE(notification.metadata, '{}'::jsonb) || jsonb_build_object('cancelledBy', ${actor}),
          updated_at = NOW()
      WHERE notification.id = ${notificationId}
        AND notification.type = 'ANNOUNCEMENT'
        AND notification.status IN ('DRAFT', 'SCHEDULED')
      RETURNING notification.id::text AS id
    `);
    const id = Number((result.rows[0] as { id?: string } | undefined)?.id);
    if (id > 0) {
      const announcement = await this.announcementDetail(id);
      if (!announcement) throw new Error('ANNOUNCEMENT_CANCEL_STATE_MISSING');
      return { status: 'CANCELLED', announcement };
    }
    const existing = await this.announcementDetail(notificationId);
    return { status: existing ? 'NOT_CANCELLABLE' : 'NOT_FOUND' };
  }

  async listAnnouncements(limit: number): Promise<AdminAnnouncementSummary[]> {
    const result = await this.db.execute(sql`
      ${announcementSummarySelect()}
      WHERE notification.type = 'ANNOUNCEMENT'
      GROUP BY notification.id
      ORDER BY notification.created_at DESC, notification.id DESC
      LIMIT ${limit}
    `);
    return (result.rows as AnnouncementRow[]).map(announcementSummary);
  }

  async announcementDetail(notificationId: number): Promise<AdminAnnouncementSummary | null> {
    const result = await this.db.execute(sql`
      ${announcementSummarySelect()}
      WHERE notification.id = ${notificationId}
        AND notification.type = 'ANNOUNCEMENT'
      GROUP BY notification.id
      LIMIT 1
    `);
    const row = result.rows[0] as AnnouncementRow | undefined;
    return row ? announcementSummary(row) : null;
  }
}

function announcementSummarySelect() {
  return sql`
    SELECT notification.id::text AS id,
           notification.status,
           notification.audience,
           notification.title,
           notification.body,
           notification.in_app_enabled,
           notification.push_enabled,
           notification.deep_link,
           notification.scheduled_at,
           notification.dispatch_started_at,
           notification.sent_at,
           notification.cancelled_at,
           notification.created_by_actor,
           notification.created_at,
           notification.updated_at,
           COUNT(recipient.id)::int AS recipient_count,
           COUNT(recipient.id) FILTER (WHERE recipient.read_at IS NULL)::int AS unread_count,
           COUNT(recipient.id) FILTER (WHERE recipient.push_status = 'SENT')::int AS push_sent_count,
           COUNT(recipient.id) FILTER (WHERE recipient.push_status = 'FAILED')::int AS push_failed_count
    FROM worklog_notifications AS notification
    LEFT JOIN worklog_notification_recipients AS recipient ON recipient.notification_id = notification.id
  `;
}

function centerItem(row: CenterRow): NotificationCenterItem {
  return {
    id: Number(row.id), category: row.category, title: row.title, body: row.body, deepLink: row.deep_link,
    createdAt: new Date(row.created_at).toISOString(), sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
}

function announcementSummary(row: AnnouncementRow): AdminAnnouncementSummary {
  return {
    id: Number(row.id), status: row.status, audience: row.audience, title: row.title, body: row.body,
    inAppEnabled: Boolean(row.in_app_enabled), pushEnabled: Boolean(row.push_enabled), deepLink: row.deep_link,
    scheduledAt: iso(row.scheduled_at), dispatchStartedAt: iso(row.dispatch_started_at), sentAt: iso(row.sent_at),
    cancelledAt: iso(row.cancelled_at), createdByActor: row.created_by_actor,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    recipientCount: Number(row.recipient_count), unreadCount: Number(row.unread_count),
    pushSentCount: Number(row.push_sent_count), pushFailedCount: Number(row.push_failed_count),
  };
}

function iso(value: Date | string | null): string | null { return value ? new Date(value).toISOString() : null; }
