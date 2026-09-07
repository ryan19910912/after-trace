import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  SubscriptionLifecycleApplied,
  SubscriptionLifecycleApplyResult,
  SubscriptionLifecycleEvent,
  SubscriptionLifecycleEventType,
  SubscriptionLifecycleRepository,
} from './subscription-lifecycle';

type ApplyRow = {
  event_id?: unknown;
  processing_result?: unknown;
  subscription_id?: unknown;
  user_id?: unknown;
  period_start?: unknown;
  period_end?: unknown;
};

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
          period_start, period_end, occurred_at, processing_result, processed_at, metadata, created_at
        )
        SELECT
          ${event.provider}, ${event.externalEventKey}, ${event.type}, ${event.userId}, 'AI_PRO',
          ${periodStart}, ${periodEnd}, ${event.occurredAt}, 'PENDING', NOW(), ${metadata}::jsonb, NOW()
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
        WHERE EXCLUDED.updated_at >= worklog_user_subscriptions.updated_at
          AND (
            worklog_user_subscriptions.current_period_start IS NULL
            OR EXCLUDED.current_period_start >= worklog_user_subscriptions.current_period_start
          )
        RETURNING id, user_id, current_period_start, current_period_end
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
        FROM subscription_upsert
        CROSS JOIN plan_row
        ON CONFLICT (owner_user_id, origin_key) DO NOTHING
        RETURNING id
      ), event_finalize AS (
        UPDATE worklog_subscription_lifecycle_events AS lifecycle_event
        SET processing_result = CASE
              WHEN subscription_upsert.id IS NULL THEN 'IGNORED_STALE'
              ELSE 'APPLIED'
            END,
            processed_at = NOW()
        FROM event_insert
        LEFT JOIN subscription_upsert ON TRUE
        WHERE lifecycle_event.id = event_insert.id
        RETURNING lifecycle_event.id, lifecycle_event.processing_result
      )
      SELECT event_finalize.id::text AS event_id,
             event_finalize.processing_result,
             subscription_upsert.id::text AS subscription_id,
             subscription_upsert.user_id::text AS user_id,
             subscription_upsert.current_period_start AS period_start,
             subscription_upsert.current_period_end AS period_end
      FROM event_finalize
      LEFT JOIN subscription_upsert ON TRUE
      LIMIT 1
    `);
    const row = result.rows[0] as ApplyRow | undefined;
    if (row?.event_id) return firstApplyResult(event, row);
    return this.resolveNoop(event);
  }

  private async applyCancel(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    const metadata = JSON.stringify(event.metadata ?? {});
    const periodStart = event.periodStart ?? null;
    const periodEnd = event.periodEnd ?? null;
    const result = await this.db.execute(sql`
      WITH current_subscription AS MATERIALIZED (
        SELECT id, user_id, current_period_start, current_period_end, updated_at
        FROM worklog_user_subscriptions
        WHERE user_id = ${event.userId}
          AND plan_code = 'AI_PRO'
          AND status = 'ACTIVE'
        LIMIT 1
      ), event_insert AS MATERIALIZED (
        INSERT INTO worklog_subscription_lifecycle_events (
          provider, external_event_key, event_type, user_id, plan_code,
          period_start, period_end, occurred_at, processing_result, processed_at, metadata, created_at
        )
        SELECT
          ${event.provider}, ${event.externalEventKey}, 'CANCEL', ${event.userId}, 'AI_PRO',
          COALESCE(${periodStart}::timestamptz, current_subscription.current_period_start),
          ${periodEnd},
          ${event.occurredAt}, 'PENDING', NOW(), ${metadata}::jsonb, NOW()
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
          AND subscription_row.updated_at <= ${event.occurredAt}
          AND (
            ${periodEnd}::timestamptz IS NULL
            OR (
              ${periodStart}::timestamptz IS NOT NULL
              AND subscription_row.current_period_start = ${periodStart}
            )
          )
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
            'periodStart', subscription_update.current_period_start,
            'periodEnd', subscription_update.current_period_end
          ),
          ${event.occurredAt}
        FROM subscription_update
        RETURNING id
      ), event_finalize AS (
        UPDATE worklog_subscription_lifecycle_events AS lifecycle_event
        SET processing_result = CASE
              WHEN subscription_update.id IS NULL THEN 'IGNORED_STALE'
              ELSE 'APPLIED'
            END,
            period_start = CASE
              WHEN subscription_update.id IS NULL THEN lifecycle_event.period_start
              ELSE subscription_update.current_period_start
            END,
            period_end = CASE
              WHEN subscription_update.id IS NULL THEN lifecycle_event.period_end
              ELSE subscription_update.current_period_end
            END,
            processed_at = NOW()
        FROM event_insert
        LEFT JOIN subscription_update ON TRUE
        WHERE lifecycle_event.id = event_insert.id
        RETURNING lifecycle_event.id, lifecycle_event.processing_result,
                  lifecycle_event.period_start, lifecycle_event.period_end
      )
      SELECT event_finalize.id::text AS event_id,
             event_finalize.processing_result,
             subscription_update.id::text AS subscription_id,
             subscription_update.user_id::text AS user_id,
             event_finalize.period_start,
             event_finalize.period_end
      FROM event_finalize
      LEFT JOIN subscription_update ON TRUE
      LIMIT 1
    `);
    const row = result.rows[0] as ApplyRow | undefined;
    if (row?.event_id) return firstApplyResult(event, row);
    return this.resolveNoop(event);
  }

  private async resolveNoop(event: SubscriptionLifecycleEvent): Promise<SubscriptionLifecycleApplyResult> {
    const existing = await this.db.execute(sql`
      SELECT lifecycle_event.processing_result,
             lifecycle_event.event_type,
             lifecycle_event.user_id::text AS user_id,
             lifecycle_event.period_start,
             lifecycle_event.period_end,
             subscription_row.id::text AS subscription_id
      FROM worklog_subscription_lifecycle_events AS lifecycle_event
      LEFT JOIN worklog_user_subscriptions AS subscription_row
        ON subscription_row.user_id = lifecycle_event.user_id
      WHERE lifecycle_event.provider = ${event.provider}
        AND lifecycle_event.external_event_key = ${event.externalEventKey}
      LIMIT 1
    `);
    const row = existing.rows[0] as (ApplyRow & { event_type?: unknown }) | undefined;
    if (row) {
      if (row.processing_result === 'IGNORED_STALE') return { status: 'DUPLICATE', applied: null };
      if (row.processing_result === 'APPLIED') {
        if (!row.subscription_id) throw new Error('SUBSCRIPTION_EVENT_SUBSCRIPTION_MISSING');
        return {
          status: 'DUPLICATE',
          applied: appliedFromRow({
            subscriptionId: row.subscription_id,
            userId: row.user_id,
            type: row.event_type,
            periodStart: row.period_start,
            periodEnd: row.period_end,
          }),
        };
      }
      throw new Error('SUBSCRIPTION_EVENT_PROCESSING_INCOMPLETE');
    }
    throw new Error(event.type === 'CANCEL' ? 'AI_PRO_SUBSCRIPTION_NOT_ACTIVE' : 'AI_PRO_PLAN_NOT_READY');
  }
}

function firstApplyResult(event: SubscriptionLifecycleEvent, row: ApplyRow): SubscriptionLifecycleApplyResult {
  if (row.processing_result === 'IGNORED_STALE') {
    return { status: 'IGNORED_STALE', userId: event.userId, type: event.type };
  }
  if (row.processing_result !== 'APPLIED' || !row.subscription_id) {
    throw new Error('SUBSCRIPTION_EVENT_PROCESSING_INCOMPLETE');
  }
  return {
    status: 'APPLIED',
    ...appliedFromRow({
      subscriptionId: row.subscription_id,
      userId: row.user_id,
      type: event.type,
      periodStart: row.period_start,
      periodEnd: row.period_end,
    }),
  };
}

function appliedFromRow(input: {
  subscriptionId: unknown;
  userId: unknown;
  type: unknown;
  periodStart: unknown;
  periodEnd: unknown;
}): SubscriptionLifecycleApplied {
  return {
    subscriptionId: positiveInteger(input.subscriptionId, 'subscription id'),
    userId: positiveInteger(input.userId, 'user id'),
    type: lifecycleEventType(input.type),
    periodStart: optionalDate(input.periodStart),
    periodEnd: optionalDate(input.periodEnd),
  };
}

function lifecycleEventType(value: unknown): SubscriptionLifecycleEventType {
  if (value === 'ACTIVATE' || value === 'RENEW' || value === 'CANCEL') return value;
  throw new Error('invalid lifecycle event type');
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
