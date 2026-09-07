import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  SubscriptionLifecycleApplyResult,
  SubscriptionLifecycleEvent,
  SubscriptionLifecycleRepository,
} from './subscription-lifecycle';

export class DrizzleSubscriptionLifecycleRepository implements SubscriptionLifecycleRepository {
  constructor(private readonly db: Database) {}

  async apply(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    if (event.type === 'CANCEL') return this.applyCancel(event);
    return this.applyPeriod(event);
  }

  private async applyPeriod(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    const periodStart = requiredDate(event.periodStart, 'SUBSCRIPTION_PERIOD_START_MISSING');
    const periodEnd = requiredDate(event.periodEnd, 'SUBSCRIPTION_PERIOD_END_MISSING');
    const metadata = JSON.stringify(event.metadata ?? {});
    const grantOrigin = `ai-pro-period:${periodStart.toISOString()}`;
    const result = await this.db.execute(sql`
      WITH plan_row AS MATERIALIZED (
        SELECT monthly_ai_point_cap
        FROM worklog_subscription_plans
        WHERE code = 'AI_PRO'
          AND plan_type = 'SUBSCRIPTION'
          AND price_twd = 99
          AND enabled = TRUE
          AND ai_enabled = TRUE
          AND monthly_ai_point_cap IS NOT NULL
          AND monthly_ai_point_cap > 0
        LIMIT 1
      ), event_insert AS MATERIALIZED (
        INSERT INTO worklog_subscription_lifecycle_events (
          provider, external_event_key, event_type, user_id, plan_code,
          period_start, period_end, occurred_at, processed_at, metadata, created_at
        )
        SELECT
          ${event.provider}, ${event.externalEventKey}, ${event.type}, ${event.userId}, 'AI_PRO',
          ${periodStart}, ${periodEnd}, ${event.occurredAt}, ${event.occurredAt}, ${metadata}::jsonb, ${event.occurredAt}
        FROM plan_row
        ON CONFLICT (provider, external_event_key) DO NOTHING
        RETURNING id
      ), previous_subscription AS MATERIALIZED (
        SELECT plan_code
        FROM worklog_user_subscriptions
        WHERE user_id = ${event.userId}
        LIMIT 1
      ), subscription_upsert AS (
        INSERT INTO worklog_user_subscriptions (
          user_id, plan_code, status, source, effective_at,
          current_period_start, current_period_end, created_at, updated_at
        )
        SELECT
          ${event.userId}, 'AI_PRO', 'ACTIVE', 'PAYMENT', ${periodStart},
          ${periodStart}, ${periodEnd}, ${event.occurredAt}, ${event.occurredAt}
        FROM event_insert
        ON CONFLICT (user_id) DO UPDATE
        SET plan_code = 'AI_PRO',
            status = 'ACTIVE',
            source = 'PAYMENT',
            effective_at = LEAST(worklog_user_subscriptions.effective_at, EXCLUDED.effective_at),
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            updated_at = EXCLUDED.updated_at
        RETURNING id, user_id
      ), history_insert AS (
        INSERT INTO worklog_subscription_history (
          user_id, previous_plan_code, next_plan_code, source, actor, metadata, created_at
        )
        SELECT
          subscription_upsert.user_id,
          previous_subscription.plan_code,
          'AI_PRO',
          'PAYMENT',
          ${`payment:${event.provider}`},
          jsonb_build_object(
            'externalEventKey', ${event.externalEventKey},
            'eventType', ${event.type},
            'periodStart', ${periodStart}::timestamptz,
            'periodEnd', ${periodEnd}::timestamptz
          ),
          ${event.occurredAt}
        FROM subscription_upsert
        LEFT JOIN previous_subscription ON TRUE
        RETURNING id
      ), grant_insert AS (
        INSERT INTO worklog_ai_grants (
          owner_user_id, type, status, original_points, remaining_points,
          provider_cost_committed_twd, provider_cost_reserved_twd,
          effective_at, expires_at, origin_key, metadata, created_at, updated_at
        )
        SELECT
          ${event.userId},
          'SUBSCRIPTION_PERIOD',
          'ACTIVE',
          plan_row.monthly_ai_point_cap,
          plan_row.monthly_ai_point_cap,
          0,
          0,
          ${periodStart},
          ${periodEnd},
          ${grantOrigin},
          jsonb_build_object(
            'planCode', 'AI_PRO',
            'provider', ${event.provider},
            'externalEventKey', ${event.externalEventKey},
            'periodStart', ${periodStart}::timestamptz,
            'periodEnd', ${periodEnd}::timestamptz
          ),
          ${event.occurredAt},
          ${event.occurredAt}
        FROM event_insert
        CROSS JOIN plan_row
        ON CONFLICT (owner_user_id, origin_key) DO NOTHING
        RETURNING id
      )
      SELECT subscription_upsert.id::text AS subscription_id,
             subscription_upsert.user_id::text AS user_id
      FROM subscription_upsert
      LIMIT 1
    `);
    const row = result.rows[0] as { subscription_id?: unknown; user_id?: unknown } | undefined;
    if (row?.subscription_id) {
      return {
        status: 'APPLIED',
        subscriptionId: positiveInteger(row.subscription_id, 'subscription id'),
        userId: positiveInteger(row.user_id, 'user id'),
        type: event.type,
        periodStart,
        periodEnd,
      };
    }
    return this.resolveNoop(event);
  }

  private async applyCancel(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    const metadata = JSON.stringify(event.metadata ?? {});
    const periodEnd = event.periodEnd ?? null;
    const result = await this.db.execute(sql`
      WITH current_subscription AS MATERIALIZED (
        SELECT id, user_id, current_period_start, current_period_end
        FROM worklog_user_subscriptions
        WHERE user_id = ${event.userId}
          AND plan_code = 'AI_PRO'
          AND status = 'ACTIVE'
        LIMIT 1
      ), event_insert AS MATERIALIZED (
        INSERT INTO worklog_subscription_lifecycle_events (
          provider, external_event_key, event_type, user_id, plan_code,
          period_start, period_end, occurred_at, processed_at, metadata, created_at
        )
        SELECT
          ${event.provider}, ${event.externalEventKey}, 'CANCEL', ${event.userId}, 'AI_PRO',
          current_subscription.current_period_start,
          ${periodEnd},
          ${event.occurredAt}, ${event.occurredAt}, ${metadata}::jsonb, ${event.occurredAt}
        FROM current_subscription
        ON CONFLICT (provider, external_event_key) DO NOTHING
        RETURNING id
      ), subscription_update AS (
        UPDATE worklog_user_subscriptions AS subscription_row
        SET status = CASE
              WHEN ${periodEnd}::timestamptz IS NULL OR ${periodEnd}::timestamptz <= ${event.occurredAt}
                THEN 'CANCELED'::worklog_subscription_status
              ELSE 'ACTIVE'::worklog_subscription_status
            END,
            current_period_end = CASE
              WHEN ${periodEnd}::timestamptz IS NULL THEN ${event.occurredAt}
              WHEN subscription_row.current_period_end IS NULL THEN ${periodEnd}
              ELSE LEAST(subscription_row.current_period_end, ${periodEnd})
            END,
            updated_at = ${event.occurredAt}
        FROM event_insert
        WHERE subscription_row.user_id = ${event.userId}
          AND subscription_row.plan_code = 'AI_PRO'
        RETURNING subscription_row.id, subscription_row.user_id,
                  subscription_row.current_period_start, subscription_row.current_period_end
      ), grant_update AS (
        UPDATE worklog_ai_grants AS g
        SET expires_at = subscription_update.current_period_end,
            updated_at = ${event.occurredAt}
        FROM subscription_update
        WHERE g.owner_user_id = subscription_update.user_id
          AND g.type = 'SUBSCRIPTION_PERIOD'
          AND g.effective_at = subscription_update.current_period_start
          AND g.status IN ('ACTIVE', 'EXHAUSTED')
        RETURNING g.id
      ), history_insert AS (
        INSERT INTO worklog_subscription_history (
          user_id, previous_plan_code, next_plan_code, source, actor, metadata, created_at
        )
        SELECT
          subscription_update.user_id,
          'AI_PRO',
          'AI_PRO',
          'PAYMENT',
          ${`payment:${event.provider}`},
          jsonb_build_object(
            'externalEventKey', ${event.externalEventKey},
            'eventType', 'CANCEL',
            'periodEnd', subscription_update.current_period_end
          ),
          ${event.occurredAt}
        FROM subscription_update
        RETURNING id
      )
      SELECT subscription_update.id::text AS subscription_id,
             subscription_update.user_id::text AS user_id,
             subscription_update.current_period_start,
             subscription_update.current_period_end
      FROM subscription_update
      LIMIT 1
    `);
    const row = result.rows[0] as {
      subscription_id?: unknown;
      user_id?: unknown;
      current_period_start?: unknown;
      current_period_end?: unknown;
    } | undefined;
    if (row?.subscription_id) {
      return {
        status: 'APPLIED',
        subscriptionId: positiveInteger(row.subscription_id, 'subscription id'),
        userId: positiveInteger(row.user_id, 'user id'),
        type: 'CANCEL',
        periodStart: optionalDate(row.current_period_start),
        periodEnd: optionalDate(row.current_period_end),
      };
    }
    return this.resolveNoop(event);
  }

  private async resolveNoop(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    const existing = await this.db.execute(sql`
      SELECT id
      FROM worklog_subscription_lifecycle_events
      WHERE provider = ${event.provider}
        AND external_event_key = ${event.externalEventKey}
      LIMIT 1
    `);
    if (existing.rows[0]) return { status: 'DUPLICATE' };
    throw new Error(event.type === 'CANCEL' ? 'AI_PRO_SUBSCRIPTION_NOT_ACTIVE' : 'AI_PRO_PLAN_NOT_READY');
  }
}

function requiredDate(value: Date | null | undefined, error: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(error);
  return new Date(value.getTime());
}

function optionalDate(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid lifecycle date');
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
