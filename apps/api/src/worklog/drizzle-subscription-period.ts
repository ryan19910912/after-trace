import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogSubscriptionPeriodGrantSnapshot,
  WorklogSubscriptionPeriodRepository,
  WorklogSubscriptionPeriodSnapshot,
  WorklogSubscriptionPlanTemplate,
} from './subscription-period';

type PlanRow = {
  code: string;
  display_name: string;
  enabled: boolean;
  price_twd: string | number;
  ai_allowance_units: string | number;
};

type SubscriptionRow = {
  user_id: string | number;
  plan_code: string;
  status: WorklogSubscriptionPeriodSnapshot['status'];
  source: WorklogSubscriptionPeriodSnapshot['source'];
  effective_at: Date | string;
  current_period_start: Date | string;
  current_period_end: Date | string | null;
  plan_enabled: boolean;
};

type AssignmentRow = SubscriptionRow & {
  grant_id: string | number | null;
  grant_original_points: string | number | null;
  grant_remaining_points: string | number | null;
  grant_effective_at: Date | string | null;
  grant_expires_at: Date | string | null;
  grant_origin_key: string | null;
};

/**
 * Subscription lifecycle + paid-period grant creation in one PostgreSQL statement.
 *
 * The historical plan template remains stored in ai_allowance_units until the schema
 * rename batch, but this repository treats it only as the number of points frozen into
 * a newly-created SUBSCRIPTION_PERIOD grant. It never reads or writes aggregate quota.
 */
export class DrizzleWorklogSubscriptionPeriodRepository implements WorklogSubscriptionPeriodRepository {
  constructor(private readonly db: Database) {}

  async getPlan(planCode: string): Promise<WorklogSubscriptionPlanTemplate | null> {
    const result = await this.db.execute(sql`
      SELECT code, display_name, enabled, price_twd::text AS price_twd, ai_allowance_units
      FROM worklog_subscription_plans
      WHERE code = ${planCode}
      LIMIT 1
    `);
    const row = result.rows[0] as PlanRow | undefined;
    return row ? planFromRow(row) : null;
  }

  async getCurrentSubscription(userId: number): Promise<WorklogSubscriptionPeriodSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        subscription.user_id::text AS user_id,
        subscription.plan_code,
        subscription.status,
        subscription.source,
        subscription.effective_at,
        subscription.current_period_start,
        subscription.current_period_end,
        COALESCE(plan.enabled, FALSE) AS plan_enabled
      FROM worklog_user_subscriptions subscription
      LEFT JOIN worklog_subscription_plans plan ON plan.code = subscription.plan_code
      WHERE subscription.user_id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as SubscriptionRow | undefined;
    return row ? subscriptionFromRow(row) : null;
  }

  async getPrivateSourceId(userId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id
      FROM worklog_sources
      WHERE type = 'PRIVATE'
        AND status = 'ACTIVE'
        AND private_user_id = ${userId}
      LIMIT 1
    `);
    const id = (result.rows[0] as { id?: unknown } | undefined)?.id;
    return id === undefined ? null : positiveInteger(id, 'private source id');
  }

  async assignPeriodAtomic(
    input: Parameters<WorklogSubscriptionPeriodRepository['assignPeriodAtomic']>[0],
  ): Promise<{
    subscription: WorklogSubscriptionPeriodSnapshot;
    grant: WorklogSubscriptionPeriodGrantSnapshot | null;
  } | null> {
    const metadataJson = JSON.stringify(input.metadata);
    const result = await this.db.execute(sql`
      WITH selected_plan AS (
        SELECT code, enabled
        FROM worklog_subscription_plans
        WHERE code = ${input.planCode}
          AND enabled = TRUE
      ),
      previous AS MATERIALIZED (
        SELECT plan_code
        FROM worklog_user_subscriptions
        WHERE user_id = ${input.userId}
        LIMIT 1
      ),
      preexisting_grant AS MATERIALIZED (
        SELECT id, original_points, remaining_points, effective_at, expires_at, origin_key
        FROM worklog_ai_grants
        WHERE owner_user_id = ${input.userId}
          AND ${input.originKey}::text IS NOT NULL
          AND origin_key = ${input.originKey}
        LIMIT 1
      ),
      changed AS (
        INSERT INTO worklog_user_subscriptions (
          user_id,
          plan_code,
          status,
          source,
          effective_at,
          current_period_start,
          current_period_end,
          created_at,
          updated_at
        )
        SELECT
          ${input.userId},
          selected_plan.code,
          'ACTIVE',
          ${input.source},
          ${input.effectiveAt},
          ${input.currentPeriodStart},
          ${input.currentPeriodEnd},
          NOW(),
          NOW()
        FROM selected_plan
        WHERE
          ${input.subscriptionPeriodPoints} = 0
          OR (
            ${input.privateSourceId}::bigint IS NOT NULL
            AND ${input.originKey}::text IS NOT NULL
            AND (
              NOT EXISTS (SELECT 1 FROM preexisting_grant)
              OR EXISTS (
                SELECT 1
                FROM preexisting_grant grant
                WHERE grant.original_points = ${input.subscriptionPeriodPoints}
                  AND grant.effective_at = ${input.currentPeriodStart}
                  AND grant.expires_at IS NOT DISTINCT FROM ${input.currentPeriodEnd}
              )
            )
          )
        ON CONFLICT (user_id) DO UPDATE
        SET
          plan_code = EXCLUDED.plan_code,
          status = 'ACTIVE',
          source = EXCLUDED.source,
          effective_at = EXCLUDED.effective_at,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          updated_at = NOW()
        RETURNING *
      ),
      grant_inserted AS (
        INSERT INTO worklog_ai_grants (
          owner_user_id,
          type,
          status,
          original_points,
          remaining_points,
          effective_at,
          expires_at,
          origin_key,
          metadata,
          created_at,
          updated_at
        )
        SELECT
          changed.user_id,
          'SUBSCRIPTION_PERIOD',
          'ACTIVE',
          ${input.subscriptionPeriodPoints},
          ${input.subscriptionPeriodPoints},
          changed.current_period_start,
          changed.current_period_end,
          ${input.originKey},
          ${metadataJson}::jsonb,
          NOW(),
          NOW()
        FROM changed
        WHERE ${input.subscriptionPeriodPoints} > 0
          AND ${input.originKey}::text IS NOT NULL
        ON CONFLICT (owner_user_id, origin_key) DO NOTHING
        RETURNING id, original_points, remaining_points, effective_at, expires_at, origin_key
      ),
      grant_resolved AS MATERIALIZED (
        SELECT id, original_points, remaining_points, effective_at, expires_at, origin_key
        FROM grant_inserted
        UNION ALL
        SELECT id, original_points, remaining_points, effective_at, expires_at, origin_key
        FROM preexisting_grant
        WHERE NOT EXISTS (SELECT 1 FROM grant_inserted)
        LIMIT 1
      ),
      private_scope AS (
        INSERT INTO worklog_ai_grant_scopes (
          grant_id,
          source_id,
          cap_points,
          used_points,
          reserved_points,
          enabled,
          created_at,
          updated_at
        )
        SELECT
          grant.id,
          ${input.privateSourceId},
          NULL,
          0,
          0,
          TRUE,
          NOW(),
          NOW()
        FROM grant_resolved grant
        WHERE ${input.subscriptionPeriodPoints} > 0
          AND ${input.privateSourceId}::bigint IS NOT NULL
        ON CONFLICT (grant_id, source_id) DO UPDATE
        SET cap_points = NULL,
            enabled = TRUE,
            updated_at = worklog_ai_grant_scopes.updated_at
        RETURNING id
      ),
      history AS (
        INSERT INTO worklog_subscription_history (
          user_id,
          previous_plan_code,
          next_plan_code,
          source,
          actor,
          metadata,
          created_at
        )
        SELECT
          changed.user_id,
          (SELECT plan_code FROM previous LIMIT 1),
          changed.plan_code,
          changed.source,
          ${input.actor},
          ${metadataJson}::jsonb,
          NOW()
        FROM changed
        RETURNING id
      ),
      audit AS (
        INSERT INTO worklog_audit_logs (
          actor_admin,
          action,
          target_type,
          target_id,
          before_value,
          after_value,
          created_at
        )
        SELECT
          ${input.actor},
          'SUBSCRIPTION_PERIOD_ASSIGNED',
          'USER_SUBSCRIPTION',
          changed.user_id::text,
          jsonb_build_object('planCode', (SELECT plan_code FROM previous LIMIT 1)),
          jsonb_build_object(
            'planCode', changed.plan_code,
            'source', changed.source,
            'periodStart', changed.current_period_start,
            'periodEnd', changed.current_period_end,
            'subscriptionPeriodPoints', ${input.subscriptionPeriodPoints},
            'grantOriginKey', ${input.originKey}
          ),
          NOW()
        FROM changed
        RETURNING id
      )
      SELECT
        changed.user_id::text AS user_id,
        changed.plan_code,
        changed.status,
        changed.source,
        changed.effective_at,
        changed.current_period_start,
        changed.current_period_end,
        selected_plan.enabled AS plan_enabled,
        grant.id::text AS grant_id,
        grant.original_points AS grant_original_points,
        grant.remaining_points AS grant_remaining_points,
        grant.effective_at AS grant_effective_at,
        grant.expires_at AS grant_expires_at,
        grant.origin_key AS grant_origin_key
      FROM changed
      INNER JOIN selected_plan ON selected_plan.code = changed.plan_code
      LEFT JOIN grant_resolved grant ON TRUE
      WHERE EXISTS (SELECT 1 FROM history)
        AND EXISTS (SELECT 1 FROM audit)
        AND (
          ${input.subscriptionPeriodPoints} = 0
          OR (
            grant.id IS NOT NULL
            AND EXISTS (SELECT 1 FROM private_scope)
          )
        )
      LIMIT 1
    `);

    const row = result.rows[0] as AssignmentRow | undefined;
    if (!row) return null;
    return {
      subscription: subscriptionFromRow(row),
      grant: row.grant_id === null ? null : grantFromRow(row),
    };
  }
}

function planFromRow(row: PlanRow): WorklogSubscriptionPlanTemplate {
  return {
    code: requiredText(row.code, 'plan code'),
    displayName: requiredText(row.display_name, 'plan display name'),
    enabled: Boolean(row.enabled),
    priceTwd: nonNegativeFinite(row.price_twd, 'plan price'),
    subscriptionPeriodPoints: nonNegativeInteger(row.ai_allowance_units, 'subscription period points'),
  };
}

function subscriptionFromRow(row: SubscriptionRow): WorklogSubscriptionPeriodSnapshot {
  const status = row.status;
  if (status !== 'ACTIVE' && status !== 'PAST_DUE' && status !== 'CANCELED' && status !== 'EXPIRED') {
    throw new Error('invalid subscription status');
  }
  const source = row.source;
  if (source !== 'FREE' && source !== 'PAYMENT' && source !== 'ADMIN') throw new Error('invalid subscription source');
  return {
    userId: positiveInteger(row.user_id, 'subscription user id'),
    planCode: requiredText(row.plan_code, 'subscription plan code'),
    status,
    source,
    effectiveAt: dateValue(row.effective_at, 'subscription effective at'),
    currentPeriodStart: dateValue(row.current_period_start, 'subscription period start'),
    currentPeriodEnd: row.current_period_end === null ? null : dateValue(row.current_period_end, 'subscription period end'),
    planEnabled: Boolean(row.plan_enabled),
  };
}

function grantFromRow(row: AssignmentRow): WorklogSubscriptionPeriodGrantSnapshot {
  if (
    row.grant_id === null
    || row.grant_original_points === null
    || row.grant_remaining_points === null
    || row.grant_effective_at === null
    || row.grant_origin_key === null
  ) {
    throw new Error('incomplete subscription period grant');
  }
  return {
    grantId: positiveInteger(row.grant_id, 'subscription grant id'),
    originalPoints: nonNegativeInteger(row.grant_original_points, 'subscription grant original points'),
    remainingPoints: nonNegativeInteger(row.grant_remaining_points, 'subscription grant remaining points'),
    effectiveAt: dateValue(row.grant_effective_at, 'subscription grant effective at'),
    expiresAt: row.grant_expires_at === null ? null : dateValue(row.grant_expires_at, 'subscription grant expires at'),
    originKey: requiredText(row.grant_origin_key, 'subscription grant origin key'),
  };
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function nonNegativeFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
}

function dateValue(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid ${label}`);
  return parsed;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}
