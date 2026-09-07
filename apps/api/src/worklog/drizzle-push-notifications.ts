import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  PushNotificationRepository,
  PushPreferencePatch,
  PushPreferences,
  PushState,
  PushSubscriptionRegistration,
} from './push-notifications';

type PushStateRow = {
  active_subscription_count: number | string;
  announcement_push_enabled: boolean | null;
  system_push_enabled: boolean | null;
  task_push_enabled: boolean | null;
};

type PreferenceRow = {
  announcement_push_enabled: boolean;
  system_push_enabled: boolean;
  task_push_enabled: boolean;
};

export class DrizzlePushNotificationRepository implements PushNotificationRepository {
  constructor(private readonly db: Database) {}

  async state(userId: number): Promise<PushState> {
    const result = await this.db.execute(sql`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM worklog_push_subscriptions AS subscription
          WHERE subscription.user_id = ${userId}
            AND subscription.revoked_at IS NULL
        ) AS active_subscription_count,
        preference.announcement_push_enabled,
        preference.system_push_enabled,
        preference.task_push_enabled
      FROM (SELECT 1) AS anchor
      LEFT JOIN worklog_notification_preferences AS preference
        ON preference.user_id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as PushStateRow | undefined;
    return {
      activeSubscriptionCount: Number(row?.active_subscription_count ?? 0),
      preferences: {
        announcementPushEnabled: row?.announcement_push_enabled ?? true,
        systemPushEnabled: row?.system_push_enabled ?? true,
        taskPushEnabled: row?.task_push_enabled ?? true,
      },
    };
  }

  async upsertSubscription(userId: number, input: PushSubscriptionRegistration): Promise<void> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_push_subscriptions (
        user_id, endpoint, p256dh, auth,
        user_agent, platform, revoked_at,
        created_at, updated_at
      )
      VALUES (
        ${userId}, ${input.endpoint}, ${input.p256dh}, ${input.auth},
        ${input.userAgent ?? null}, ${input.platform ?? null}, NULL,
        NOW(), NOW()
      )
      ON CONFLICT (endpoint) DO UPDATE
      SET p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent,
          platform = EXCLUDED.platform,
          revoked_at = NULL,
          updated_at = NOW()
      WHERE worklog_push_subscriptions.user_id = ${userId}
      RETURNING id
    `);
    if (!result.rows[0]) throw new Error('PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT');
  }

  async revokeSubscription(userId: number, endpoint: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_push_subscriptions AS subscription
      SET revoked_at = COALESCE(subscription.revoked_at, NOW()),
          updated_at = NOW()
      WHERE subscription.user_id = ${userId}
        AND subscription.endpoint = ${endpoint}
        AND subscription.revoked_at IS NULL
      RETURNING subscription.id
    `);
    return Boolean(result.rows[0]);
  }

  async updatePreferences(userId: number, patch: PushPreferencePatch): Promise<PushPreferences> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_notification_preferences (
        user_id,
        announcement_push_enabled,
        system_push_enabled,
        task_push_enabled,
        created_at,
        updated_at
      )
      VALUES (
        ${userId},
        COALESCE(${patch.announcementPushEnabled ?? null}, TRUE),
        COALESCE(${patch.systemPushEnabled ?? null}, TRUE),
        COALESCE(${patch.taskPushEnabled ?? null}, TRUE),
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET announcement_push_enabled = COALESCE(
            ${patch.announcementPushEnabled ?? null},
            worklog_notification_preferences.announcement_push_enabled
          ),
          system_push_enabled = COALESCE(
            ${patch.systemPushEnabled ?? null},
            worklog_notification_preferences.system_push_enabled
          ),
          task_push_enabled = COALESCE(
            ${patch.taskPushEnabled ?? null},
            worklog_notification_preferences.task_push_enabled
          ),
          updated_at = NOW()
      RETURNING announcement_push_enabled,
                system_push_enabled,
                task_push_enabled
    `);
    const row = result.rows[0] as PreferenceRow | undefined;
    if (!row) throw new Error('PUSH_PREFERENCE_UPDATE_FAILED');
    return {
      announcementPushEnabled: Boolean(row.announcement_push_enabled),
      systemPushEnabled: Boolean(row.system_push_enabled),
      taskPushEnabled: Boolean(row.task_push_enabled),
    };
  }
}
