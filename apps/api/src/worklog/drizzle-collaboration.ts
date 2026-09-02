import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  GroupAuthorizationContext,
  WorklogCollaborationRepository,
} from './collaboration';
import type { WorklogSubscriptionStatus } from './subscription';

type AuthorizationRow = {
  source_id: string;
  source_status: 'ACTIVE' | 'INACTIVE';
  owner_user_id: string | null;
  member_active: boolean | null;
  recording_enabled: boolean | null;
  plan_code: string | null;
  plan_display_name: string | null;
  subscription_status: WorklogSubscriptionStatus | null;
  effective_at: Date | string | null;
  current_period_start: Date | string | null;
  current_period_end: Date | string | null;
  plan_enabled: boolean | null;
  capabilities: unknown;
  ai_allowance_units: number | string | null;
  consumed_units: number | string | null;
  owner_group_position: number | string | null;
};

export class DrizzleWorklogCollaborationRepository implements WorklogCollaborationRepository {
  constructor(private readonly db: Database) {}

  async getGroupAuthorizationContext(
    sourceId: number,
    actorUserId: number,
  ): Promise<GroupAuthorizationContext | null> {
    const result = await this.db.execute(sql`
      SELECT
        source.id::text AS source_id,
        source.status AS source_status,
        source.owner_user_id::text AS owner_user_id,
        member.is_active AS member_active,
        member.recording_enabled,
        subscription.plan_code,
        plan.display_name AS plan_display_name,
        subscription.status AS subscription_status,
        subscription.effective_at,
        subscription.current_period_start,
        subscription.current_period_end,
        COALESCE(plan.enabled, FALSE) AS plan_enabled,
        COALESCE(plan.capabilities, '{}'::jsonb) AS capabilities,
        COALESCE(balance.allowance_units, plan.ai_allowance_units, 0) AS ai_allowance_units,
        COALESCE(balance.used_units, 0) + COALESCE(balance.reserved_units, 0) AS consumed_units,
        CASE
          WHEN source.owner_user_id IS NULL THEN 1
          ELSE (
            SELECT COUNT(*)
            FROM worklog_sources AS sibling
            WHERE sibling.type = 'GROUP'
              AND sibling.status = 'ACTIVE'
              AND sibling.owner_user_id = source.owner_user_id
              AND (COALESCE(sibling.owner_bound_at, sibling.created_at), sibling.id)
                  <= (COALESCE(source.owner_bound_at, source.created_at), source.id)
          )
        END AS owner_group_position
      FROM worklog_sources AS source
      LEFT JOIN worklog_source_members AS member
        ON member.source_id = source.id
       AND member.user_id = ${actorUserId}
      LEFT JOIN worklog_user_subscriptions AS subscription
        ON subscription.user_id = source.owner_user_id
      LEFT JOIN worklog_subscription_plans AS plan
        ON plan.code = subscription.plan_code
      LEFT JOIN worklog_ai_quota_balances AS balance
        ON balance.user_id = source.owner_user_id
       AND balance.period_start = subscription.current_period_start
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
      LIMIT 1
    `);

    const row = result.rows[0] as AuthorizationRow | undefined;
    if (!row) return null;
    return {
      sourceId: Number(row.source_id),
      sourceStatus: row.source_status,
      ownerUserId: nullableNumber(row.owner_user_id),
      actorIsActiveMember: row.member_active === true,
      actorRecordingEnabled: row.recording_enabled !== false,
      ownerPlanCode: row.plan_code,
      ownerPlanDisplayName: row.plan_display_name,
      ownerSubscriptionStatus: row.subscription_status,
      ownerEffectiveAt: nullableDate(row.effective_at),
      ownerPeriodStart: nullableDate(row.current_period_start),
      ownerPeriodEnd: nullableDate(row.current_period_end),
      ownerPlanEnabled: row.plan_enabled === true,
      ownerCapabilities: row.capabilities,
      ownerAllowanceUnits: numeric(row.ai_allowance_units),
      ownerConsumedUnits: numeric(row.consumed_units),
      ownerGroupPosition: numeric(row.owner_group_position),
    };
  }

  async getGroupOwnerUserId(sourceId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT owner_user_id::text AS owner_user_id
      FROM worklog_sources
      WHERE id = ${sourceId}
        AND type = 'GROUP'
      LIMIT 1
    `);
    const value = (result.rows[0] as { owner_user_id?: string | null } | undefined)?.owner_user_id;
    return nullableNumber(value ?? null);
  }

  async isActiveGroupMember(sourceId: number, userId: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM worklog_source_members AS member
        INNER JOIN worklog_sources AS source ON source.id = member.source_id
        WHERE member.source_id = ${sourceId}
          AND member.user_id = ${userId}
          AND member.is_active = TRUE
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
      ) AS active
    `);
    return Boolean((result.rows[0] as { active?: boolean } | undefined)?.active);
  }

  async setMemberRecordingEnabled(
    sourceId: number,
    memberUserId: number,
    enabled: boolean,
    updatedByUserId: number,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_source_members
      SET
        recording_enabled = ${enabled},
        recording_updated_by_user_id = ${updatedByUserId},
        recording_updated_at = NOW(),
        updated_at = NOW()
      WHERE source_id = ${sourceId}
        AND user_id = ${memberUserId}
        AND is_active = TRUE
    `);
  }

  async bindGroupOwnerIfUnbound(
    sourceId: number,
    ownerUserId: number,
    bindingMethod: string,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_sources AS source
      SET
        workspace_id = workspace.id,
        owner_user_id = ${ownerUserId},
        subscription_owner_user_id = ${ownerUserId},
        owner_binding_method = ${bindingMethod},
        owner_bound_at = NOW(),
        updated_at = NOW()
      FROM worklog_workspaces AS workspace
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
        AND source.owner_user_id IS NULL
        AND workspace.owner_user_id = ${ownerUserId}
      RETURNING source.id
    `);
    return result.rows.length === 1;
  }
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function numeric(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
