import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAiReservationSnapshot,
  WorklogAiUsageCommit,
  WorklogPlanSnapshot,
  WorklogSubscriptionRepository,
  WorklogSubscriptionSnapshot,
} from './subscription';

type PlanRow = {
  code: string;
  display_name: string;
  enabled: boolean;
  ai_allowance_units: number | string;
  capabilities: unknown;
};

type SubscriptionRow = {
  user_id: string | number;
  plan_code: string;
  status: WorklogSubscriptionSnapshot['status'];
  source: WorklogSubscriptionSnapshot['source'];
  effective_at: Date | string;
  current_period_start: Date | string;
  current_period_end: Date | string | null;
  ai_units_used: number | string;
  ai_units_reserved: number | string;
  plan_enabled: boolean;
  ai_allowance_units: number | string;
  capabilities: unknown;
};

type ReservationRow = {
  token: string;
  charged_user_id: string | number;
  actor_user_id: string | number;
  source_id: string | number | null;
  units_reserved: number | string;
  units_committed: number | string;
  status: WorklogAiReservationSnapshot['status'];
  period_start: Date | string;
  period_end: Date | string | null;
  expires_at: Date | string;
};

export class DrizzleWorklogSubscriptionRepository implements WorklogSubscriptionRepository {
  constructor(private readonly db: Database) {}

  async getPlan(planCode: string): Promise<WorklogPlanSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        code,
        display_name,
        enabled,
        ai_allowance_units,
        capabilities
      FROM worklog_subscription_plans
      WHERE code = ${planCode}
      LIMIT 1
    `);
    const row = result.rows[0] as PlanRow | undefined;
    return row ? planFromRow(row) : null;
  }

  async getCurrentSubscription(userId: number): Promise<WorklogSubscriptionSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        subscription.user_id::text AS user_id,
        subscription.plan_code,
        subscription.status,
        subscription.source,
        subscription.effective_at,
        subscription.current_period_start,
        subscription.current_period_end,
        subscription.ai_units_used,
        subscription.ai_units_reserved,
        COALESCE(plan.enabled, FALSE) AS plan_enabled,
        COALESCE(plan.ai_allowance_units, 0) AS ai_allowance_units,
        COALESCE(plan.capabilities, '{}'::jsonb) AS capabilities
      FROM worklog_user_subscriptions AS subscription
      LEFT JOIN worklog_subscription_plans AS plan ON plan.code = subscription.plan_code
      WHERE subscription.user_id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as SubscriptionRow | undefined;
    return row ? subscriptionFromRow(row) : null;
  }

  async assignPlan(
    input: Parameters<WorklogSubscriptionRepository['assignPlan']>[0],
  ): Promise<WorklogSubscriptionSnapshot | null> {
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const result = await this.db.execute(sql`
      WITH selected_plan AS (
        SELECT code
        FROM worklog_subscription_plans
        WHERE code = ${input.planCode}
          AND enabled = TRUE
      ),
      previous AS (
        SELECT plan_code
        FROM worklog_user_subscriptions
        WHERE user_id = ${input.userId}
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
          ai_units_used,
          ai_units_reserved,
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
          0,
          0,
          NOW(),
          NOW()
        FROM selected_plan
        ON CONFLICT (user_id) DO UPDATE
        SET
          plan_code = EXCLUDED.plan_code,
          status = 'ACTIVE',
          source = EXCLUDED.source,
          effective_at = EXCLUDED.effective_at,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          ai_units_used = 0,
          ai_units_reserved = 0,
          updated_at = NOW()
        RETURNING *
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
          'SUBSCRIPTION_PLAN_ASSIGNED',
          'USER_SUBSCRIPTION',
          changed.user_id::text,
          jsonb_build_object('planCode', (SELECT plan_code FROM previous LIMIT 1)),
          jsonb_build_object(
            'planCode', changed.plan_code,
            'source', changed.source,
            'periodStart', changed.current_period_start,
            'periodEnd', changed.current_period_end
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
        changed.ai_units_used,
        changed.ai_units_reserved,
        plan.enabled AS plan_enabled,
        plan.ai_allowance_units,
        plan.capabilities
      FROM changed
      INNER JOIN worklog_subscription_plans AS plan ON plan.code = changed.plan_code
      WHERE EXISTS (SELECT 1 FROM history)
        AND EXISTS (SELECT 1 FROM audit)
      LIMIT 1
    `);
    const row = result.rows[0] as SubscriptionRow | undefined;
    return row ? subscriptionFromRow(row) : null;
  }

  async expireStaleAiReservations(chargedUserId: number, at: Date): Promise<number> {
    const result = await this.db.execute(sql`
      WITH expired AS (
        UPDATE worklog_ai_quota_reservations
        SET
          status = 'EXPIRED',
          updated_at = NOW()
        WHERE charged_user_id = ${chargedUserId}
          AND status = 'RESERVED'
          AND expires_at <= ${at}
        RETURNING units_reserved
      ),
      totals AS (
        SELECT COALESCE(SUM(units_reserved), 0)::integer AS released_units
        FROM expired
      ),
      adjusted AS (
        UPDATE worklog_user_subscriptions AS subscription
        SET
          ai_units_reserved = GREATEST(0, subscription.ai_units_reserved - totals.released_units),
          updated_at = NOW()
        FROM totals
        WHERE subscription.user_id = ${chargedUserId}
          AND totals.released_units > 0
        RETURNING subscription.user_id
      )
      SELECT COUNT(*)::integer AS expired_count
      FROM expired
    `);
    return numeric((result.rows[0] as { expired_count?: number | string } | undefined)?.expired_count ?? 0);
  }

  async reserveAiUnitsAtomic(
    input: Parameters<WorklogSubscriptionRepository['reserveAiUnitsAtomic']>[0],
  ): Promise<WorklogAiReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      WITH reserved AS (
        UPDATE worklog_user_subscriptions AS subscription
        SET
          ai_units_reserved = subscription.ai_units_reserved + ${input.requestedUnits},
          updated_at = NOW()
        FROM worklog_subscription_plans AS plan
        WHERE subscription.user_id = ${input.chargedUserId}
          AND subscription.plan_code = plan.code
          AND subscription.status = 'ACTIVE'
          AND plan.enabled = TRUE
          AND subscription.effective_at <= ${input.at}
          AND subscription.current_period_start <= ${input.at}
          AND (
            subscription.current_period_end IS NULL
            OR ${input.at} < subscription.current_period_end
          )
          AND subscription.ai_units_used + subscription.ai_units_reserved + ${input.requestedUnits}
            <= plan.ai_allowance_units
        RETURNING
          subscription.user_id,
          subscription.current_period_start,
          subscription.current_period_end
      ),
      inserted AS (
        INSERT INTO worklog_ai_quota_reservations (
          token,
          charged_user_id,
          actor_user_id,
          source_id,
          units_reserved,
          units_committed,
          status,
          period_start,
          period_end,
          expires_at,
          created_at,
          updated_at
        )
        SELECT
          ${input.token},
          reserved.user_id,
          ${input.actorUserId},
          ${input.sourceId},
          ${input.requestedUnits},
          0,
          'RESERVED',
          reserved.current_period_start,
          reserved.current_period_end,
          ${input.expiresAt},
          NOW(),
          NOW()
        FROM reserved
        RETURNING *
      )
      SELECT
        token,
        charged_user_id::text AS charged_user_id,
        actor_user_id::text AS actor_user_id,
        source_id::text AS source_id,
        units_reserved,
        units_committed,
        status,
        period_start,
        period_end,
        expires_at
      FROM inserted
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? reservationFromRow(row) : null;
  }

  async getAiReservation(token: string): Promise<WorklogAiReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        token,
        charged_user_id::text AS charged_user_id,
        actor_user_id::text AS actor_user_id,
        source_id::text AS source_id,
        units_reserved,
        units_committed,
        status,
        period_start,
        period_end,
        expires_at
      FROM worklog_ai_quota_reservations
      WHERE token = ${token}
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? reservationFromRow(row) : null;
  }

  async commitAiReservationAtomic(
    token: string,
    usage: WorklogAiUsageCommit,
    at: Date,
  ): Promise<WorklogAiReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      WITH claimed AS (
        UPDATE worklog_ai_quota_reservations AS reservation
        SET
          status = 'COMMITTED',
          units_committed = ${usage.actualUnits},
          updated_at = NOW()
        WHERE reservation.token = ${token}
          AND reservation.status = 'RESERVED'
          AND reservation.units_reserved >= ${usage.actualUnits}
        RETURNING *
      ),
      adjusted AS (
        UPDATE worklog_user_subscriptions AS subscription
        SET
          ai_units_reserved = GREATEST(0, subscription.ai_units_reserved - claimed.units_reserved),
          ai_units_used = subscription.ai_units_used + claimed.units_committed,
          updated_at = NOW()
        FROM claimed
        WHERE subscription.user_id = claimed.charged_user_id
          AND subscription.current_period_start = claimed.period_start
          AND (
            (subscription.current_period_end IS NULL AND claimed.period_end IS NULL)
            OR subscription.current_period_end = claimed.period_end
          )
        RETURNING subscription.user_id
      ),
      usage_event AS (
        INSERT INTO worklog_ai_usage_events (
          actor_user_id,
          charged_user_id,
          workspace_id,
          source_id,
          record_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          audio_input_units,
          image_input_units,
          input_usd_per_million,
          output_usd_per_million,
          audio_usd_per_million,
          image_usd_per_million,
          usd_twd_rate,
          provider_cost_usd,
          provider_cost_twd,
          ai_units_consumed,
          created_at
        )
        SELECT
          claimed.actor_user_id,
          claimed.charged_user_id,
          ${usage.workspaceId ?? null},
          claimed.source_id,
          ${usage.recordId ?? null},
          ${usage.provider},
          ${usage.model},
          ${usage.inputTokens},
          ${usage.outputTokens},
          ${usage.audioInputUnits ?? 0},
          ${usage.imageInputUnits ?? 0},
          ${usage.inputUsdPerMillion},
          ${usage.outputUsdPerMillion},
          ${usage.audioUsdPerMillion ?? null},
          ${usage.imageUsdPerMillion ?? null},
          ${usage.usdTwdRate ?? null},
          ${usage.providerCostUsd},
          ${usage.providerCostTwd ?? null},
          claimed.units_committed,
          ${at}
        FROM claimed
        WHERE EXISTS (SELECT 1 FROM adjusted)
        RETURNING id
      )
      SELECT
        claimed.token,
        claimed.charged_user_id::text AS charged_user_id,
        claimed.actor_user_id::text AS actor_user_id,
        claimed.source_id::text AS source_id,
        claimed.units_reserved,
        claimed.units_committed,
        claimed.status,
        claimed.period_start,
        claimed.period_end,
        claimed.expires_at
      FROM claimed
      WHERE EXISTS (SELECT 1 FROM adjusted)
        AND EXISTS (SELECT 1 FROM usage_event)
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? reservationFromRow(row) : null;
  }

  async releaseAiReservationAtomic(
    token: string,
    at: Date,
  ): Promise<WorklogAiReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      WITH released AS (
        UPDATE worklog_ai_quota_reservations
        SET
          status = 'RELEASED',
          updated_at = ${at}
        WHERE token = ${token}
          AND status = 'RESERVED'
        RETURNING *
      ),
      adjusted AS (
        UPDATE worklog_user_subscriptions AS subscription
        SET
          ai_units_reserved = GREATEST(0, subscription.ai_units_reserved - released.units_reserved),
          updated_at = NOW()
        FROM released
        WHERE subscription.user_id = released.charged_user_id
          AND subscription.current_period_start = released.period_start
          AND (
            (subscription.current_period_end IS NULL AND released.period_end IS NULL)
            OR subscription.current_period_end = released.period_end
          )
        RETURNING subscription.user_id
      )
      SELECT
        released.token,
        released.charged_user_id::text AS charged_user_id,
        released.actor_user_id::text AS actor_user_id,
        released.source_id::text AS source_id,
        released.units_reserved,
        released.units_committed,
        released.status,
        released.period_start,
        released.period_end,
        released.expires_at
      FROM released
      WHERE EXISTS (SELECT 1 FROM adjusted)
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? reservationFromRow(row) : null;
  }
}

function planFromRow(row: PlanRow): WorklogPlanSnapshot {
  return {
    code: row.code,
    displayName: row.display_name,
    enabled: row.enabled,
    aiAllowanceUnits: numeric(row.ai_allowance_units),
    capabilities: row.capabilities,
  };
}

function subscriptionFromRow(row: SubscriptionRow): WorklogSubscriptionSnapshot {
  return {
    userId: numeric(row.user_id),
    planCode: row.plan_code,
    status: row.status,
    source: row.source,
    effectiveAt: dateValue(row.effective_at),
    currentPeriodStart: dateValue(row.current_period_start),
    currentPeriodEnd: row.current_period_end === null ? null : dateValue(row.current_period_end),
    aiUnitsUsed: numeric(row.ai_units_used),
    aiUnitsReserved: numeric(row.ai_units_reserved),
    planEnabled: row.plan_enabled,
    aiAllowanceUnits: numeric(row.ai_allowance_units),
    capabilities: row.capabilities,
  };
}

function reservationFromRow(row: ReservationRow): WorklogAiReservationSnapshot {
  return {
    token: row.token,
    chargedUserId: numeric(row.charged_user_id),
    actorUserId: numeric(row.actor_user_id),
    sourceId: row.source_id === null ? null : numeric(row.source_id),
    unitsReserved: numeric(row.units_reserved),
    unitsCommitted: numeric(row.units_committed),
    status: row.status,
    periodStart: dateValue(row.period_start),
    periodEnd: row.period_end === null ? null : dateValue(row.period_end),
    expiresAt: dateValue(row.expires_at),
  };
}

function numeric(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('invalid numeric database value');
  return parsed;
}

function dateValue(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid date database value');
  return parsed;
}
