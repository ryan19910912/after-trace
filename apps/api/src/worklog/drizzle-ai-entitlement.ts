import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { FREE_INITIAL_GRANT_ORIGIN_KEY } from './ai-points';
import type { AiEntitlementRepository, AiEntitlementSnapshot } from './ai-entitlement';

type SnapshotRow = {
  source_authorized: boolean;
  trial_grant_id: string | null;
  trial_remaining_points: string | number | null;
  trial_per_request_ai_point_cap: string | number | null;
  plan_enabled: boolean | null;
  ai_enabled: boolean | null;
  subscription_grant_id: string | null;
  period_start: Date | string | null;
  period_end: Date | string | null;
  monthly_ai_point_cap: string | number | null;
  monthly_provider_cost_cap_twd: string | number | null;
  per_request_ai_point_cap: string | number | null;
  points_used: string | number | null;
  provider_cost_twd: string | number | null;
  missing_provider_cost_twd_requests: string | number | null;
};

export class DrizzleAiEntitlementRepository implements AiEntitlementRepository {
  constructor(private readonly db: Database) {}

  async snapshot(userId: number, sourceId: number, at: Date): Promise<AiEntitlementSnapshot> {
    const result = await this.db.execute(sql`
      WITH source_access AS (
        SELECT EXISTS (
          SELECT 1
          FROM worklog_sources AS source_row
          WHERE source_row.id = ${sourceId}
            AND source_row.status = 'ACTIVE'
            AND (
              (source_row.type = 'PRIVATE' AND source_row.private_user_id = ${userId})
              OR (
                source_row.type = 'GROUP'
                AND EXISTS (
                  SELECT 1
                  FROM worklog_source_members AS member_row
                  WHERE member_row.source_id = source_row.id
                    AND member_row.user_id = ${userId}
                    AND member_row.is_active = TRUE
                )
              )
            )
        ) AS authorized
      ),
      ai_pro_template AS (
        SELECT enabled, ai_enabled, per_request_ai_point_cap
        FROM worklog_subscription_plans
        WHERE code = 'AI_PRO'
          AND plan_type = 'SUBSCRIPTION'
          AND price_twd = 99
        LIMIT 1
      ),
      active_subscription AS (
        SELECT subscription.plan_code,
               subscription.current_period_start,
               subscription.current_period_end,
               plan.enabled AS plan_enabled,
               plan.ai_enabled,
               plan.monthly_ai_point_cap,
               plan.monthly_provider_cost_cap_twd,
               plan.per_request_ai_point_cap
        FROM worklog_user_subscriptions AS subscription
        INNER JOIN worklog_subscription_plans AS plan
          ON plan.code = subscription.plan_code
        WHERE subscription.user_id = ${userId}
          AND subscription.status = 'ACTIVE'
          AND subscription.plan_code = 'AI_PRO'
          AND subscription.effective_at <= ${at}
          AND subscription.current_period_start <= ${at}
          AND subscription.current_period_end IS NOT NULL
          AND subscription.current_period_end > ${at}
        LIMIT 1
      ),
      paid_grant AS (
        SELECT g.id
        FROM worklog_ai_grants AS g
        INNER JOIN active_subscription AS subscription ON TRUE
        WHERE g.owner_user_id = ${userId}
          AND g.type = 'SUBSCRIPTION_PERIOD'
          AND g.status = 'ACTIVE'
          AND g.effective_at = subscription.current_period_start
          AND g.expires_at IS NOT DISTINCT FROM subscription.current_period_end
        ORDER BY g.id DESC
        LIMIT 1
      ),
      period_usage AS (
        SELECT COALESCE(SUM(event.customer_points_charged + event.platform_subsidized_points), 0)::bigint AS points_used,
               COALESCE(SUM(event.provider_cost_twd), 0)::numeric AS provider_cost_twd,
               COUNT(*) FILTER (WHERE event.provider_cost_twd IS NULL)::bigint AS missing_provider_cost_twd_requests
        FROM worklog_ai_usage_events AS event
        INNER JOIN active_subscription AS subscription ON TRUE
        WHERE event.charged_user_id = ${userId}
          AND event.created_at >= subscription.current_period_start
          AND event.created_at < subscription.current_period_end
      ),
      free_trial AS (
        SELECT g.id, g.remaining_points
        FROM worklog_ai_grants AS g
        WHERE g.owner_user_id = ${userId}
          AND g.type = 'FREE_INITIAL'
          AND g.origin_key = ${FREE_INITIAL_GRANT_ORIGIN_KEY}
          AND g.status IN ('ACTIVE', 'EXHAUSTED')
          AND g.effective_at <= ${at}
          AND (g.expires_at IS NULL OR g.expires_at > ${at})
        ORDER BY g.id ASC
        LIMIT 1
      )
      SELECT
        (SELECT authorized FROM source_access) AS source_authorized,
        free_trial.id::text AS trial_grant_id,
        free_trial.remaining_points AS trial_remaining_points,
        ai_pro_template.per_request_ai_point_cap AS trial_per_request_ai_point_cap,
        active_subscription.plan_enabled,
        active_subscription.ai_enabled,
        paid_grant.id::text AS subscription_grant_id,
        active_subscription.current_period_start AS period_start,
        active_subscription.current_period_end AS period_end,
        active_subscription.monthly_ai_point_cap,
        active_subscription.monthly_provider_cost_cap_twd,
        active_subscription.per_request_ai_point_cap,
        period_usage.points_used,
        period_usage.provider_cost_twd,
        period_usage.missing_provider_cost_twd_requests
      FROM source_access
      LEFT JOIN ai_pro_template ON TRUE
      LEFT JOIN free_trial ON TRUE
      LEFT JOIN active_subscription ON TRUE
      LEFT JOIN paid_grant ON TRUE
      LEFT JOIN period_usage ON TRUE
      LIMIT 1
    `);
    const row = result.rows[0] as SnapshotRow | undefined;
    if (!row) throw new Error('AI_ENTITLEMENT_LOOKUP_FAILED');
    const aiPro = row.period_start && row.period_end && row.monthly_ai_point_cap !== null && row.monthly_provider_cost_cap_twd !== null
      ? {
          planEnabled: Boolean(row.plan_enabled),
          aiEnabled: Boolean(row.ai_enabled),
          grantId: optionalPositiveInteger(row.subscription_grant_id),
          periodStart: dateValue(row.period_start),
          periodEnd: dateValue(row.period_end),
          monthlyPointCap: positiveInteger(row.monthly_ai_point_cap, 'monthly AI point cap'),
          monthlyProviderCostCapTwd: positiveFinite(row.monthly_provider_cost_cap_twd, 'monthly provider cost cap'),
          perRequestAiPointCap: optionalPositiveInteger(row.per_request_ai_point_cap),
          pointsUsed: nonNegativeInteger(row.points_used ?? 0, 'period points used'),
          providerCostTwd: nonNegativeFinite(row.provider_cost_twd ?? 0, 'period provider cost'),
          missingProviderCostTwdRequests: nonNegativeInteger(
            row.missing_provider_cost_twd_requests ?? 0,
            'missing provider cost requests',
          ),
        }
      : null;
    const freeTrial = row.trial_grant_id
      ? {
          grantId: positiveInteger(row.trial_grant_id, 'FREE trial grant id'),
          remainingPoints: nonNegativeInteger(row.trial_remaining_points ?? 0, 'FREE trial remaining points'),
          perRequestAiPointCap: optionalPositiveInteger(row.trial_per_request_ai_point_cap),
        }
      : null;
    return { sourceAuthorized: Boolean(row.source_authorized), freeTrial, aiPro };
  }

  async ensureGrantScope(grantId: number, sourceId: number, at: Date): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_ai_grant_scopes (
        grant_id, source_id, cap_points, used_points, reserved_points, enabled, created_at, updated_at
      )
      VALUES (${grantId}, ${sourceId}, NULL, 0, 0, TRUE, ${at}, ${at})
      ON CONFLICT (grant_id, source_id) DO UPDATE
      SET enabled = TRUE,
          updated_at = GREATEST(worklog_ai_grant_scopes.updated_at, EXCLUDED.updated_at)
    `);
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
}
function positiveInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function optionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return positiveInteger(value, 'optional positive integer');
}
function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function positiveFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function nonNegativeFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}
function dateValue(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid entitlement date');
  return parsed;
}
