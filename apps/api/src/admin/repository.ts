import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type WorklogAdminOverview = {
  users: number;
  oaFriends: number;
  groups: number;
  activeGroups: number;
  records: number;
  recordsToday: number;
  aiCallsToday: number;
  aiCostTwdToday: string;
  openAnomalies: number;
  failedAttachments: number;
  failedNormalizations: number;
  feedback30d: number;
};

export type AdminUserQuery = {
  query: string | null;
  planCode: string | null;
  userType: 'INDIVIDUAL' | 'GROUP_ENABLED' | null;
  sortUpdated: 'ASC' | 'DESC';
  limit: number;
};

export type AdminPlanInput = {
  code: string;
  displayName: string;
  priceTwd: string;
  rank: number;
  enabled: boolean;
  aiAllowanceUnits: number;
  capabilities: Record<string, boolean | number | string>;
};

export type AdminAiRuntimeInput = {
  provider: string;
  model: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  audioUsdPerMillion: string | null;
  imageUsdPerMillion: string | null;
  usdTwdRate: string | null;
};

export class DrizzleAdminRepository {
  constructor(private readonly db: Database) {}

  async overview(at = new Date()): Promise<WorklogAdminOverview> {
    const dayStart = taipeiDayStart(at);
    const feedbackStart = new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM worklog_users)::text AS users,
        (SELECT COUNT(*) FROM worklog_users WHERE is_oa_friend = TRUE)::text AS oa_friends,
        (SELECT COUNT(*) FROM worklog_sources WHERE type = 'GROUP')::text AS groups,
        (SELECT COUNT(*) FROM worklog_sources WHERE type = 'GROUP' AND status = 'ACTIVE')::text AS active_groups,
        (SELECT COUNT(*) FROM worklog_records)::text AS records,
        (SELECT COUNT(*) FROM worklog_records WHERE created_at >= ${dayStart})::text AS records_today,
        (SELECT COUNT(*) FROM worklog_ai_usage_events WHERE created_at >= ${dayStart})::text AS ai_calls_today,
        COALESCE((SELECT SUM(provider_cost_twd) FROM worklog_ai_usage_events WHERE created_at >= ${dayStart}), 0)::text AS ai_cost_twd_today,
        (SELECT COUNT(*) FROM worklog_anomaly_events WHERE status = 'OPEN')::text AS open_anomalies,
        (SELECT COUNT(*) FROM worklog_attachment_ingestions WHERE status = 'FAILED')::text AS failed_attachments,
        (SELECT COUNT(*) FROM worklog_record_ai_normalizations WHERE status = 'FAILED')::text AS failed_normalizations,
        (SELECT COUNT(*) FROM worklog_feedback WHERE created_at >= ${feedbackStart})::text AS feedback_30d
    `);
    const row = result.rows[0] as Record<string, string>;
    return {
      users: numeric(row.users),
      oaFriends: numeric(row.oa_friends),
      groups: numeric(row.groups),
      activeGroups: numeric(row.active_groups),
      records: numeric(row.records),
      recordsToday: numeric(row.records_today),
      aiCallsToday: numeric(row.ai_calls_today),
      aiCostTwdToday: row.ai_cost_twd_today ?? '0',
      openAnomalies: numeric(row.open_anomalies),
      failedAttachments: numeric(row.failed_attachments),
      failedNormalizations: numeric(row.failed_normalizations),
      feedback30d: numeric(row.feedback_30d),
    };
  }

  async users(input: AdminUserQuery) {
    const result = await this.db.execute(sql`
      SELECT
        u.id::text AS id,
        u.line_user_id,
        u.display_name,
        u.is_oa_friend,
        COALESCE(subscription.plan_code, 'FREE') AS plan_code,
        subscription.status AS subscription_status,
        COALESCE(balance.allowance_units, plan.ai_allowance_units, 0)::text AS ai_allowance_units,
        COALESCE(balance.used_units, 0)::text AS ai_used_units,
        COALESCE(balance.reserved_units, 0)::text AS ai_reserved_units,
        GREATEST(
          COALESCE(balance.allowance_units, plan.ai_allowance_units, 0)
            - COALESCE(balance.used_units, 0)
            - COALESCE(balance.reserved_units, 0),
          0
        )::text AS ai_remaining_units,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'TEXT')::text AS text_count,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'AUDIO')::text AS audio_count,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'IMAGE')::text AS image_count,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'FILE')::text AS file_count,
        (SELECT COUNT(*) FROM worklog_sources s WHERE s.type = 'GROUP' AND s.status = 'ACTIVE' AND s.owner_user_id = u.id)::text AS owned_group_count,
        (SELECT COUNT(*) FROM worklog_source_members m INNER JOIN worklog_sources s ON s.id = m.source_id WHERE m.user_id = u.id AND m.is_active = TRUE AND s.type = 'GROUP' AND s.status = 'ACTIVE')::text AS member_group_count,
        CASE WHEN EXISTS (
          SELECT 1 FROM worklog_sources s WHERE s.type = 'GROUP' AND s.status = 'ACTIVE' AND s.owner_user_id = u.id
        ) THEN 'GROUP_ENABLED' ELSE 'INDIVIDUAL' END AS user_type,
        u.last_interaction_at,
        u.updated_at
      FROM worklog_users u
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
      LEFT JOIN worklog_subscription_plans plan ON plan.code = subscription.plan_code
      LEFT JOIN worklog_ai_quota_balances balance
        ON balance.user_id = u.id
       AND balance.period_start = subscription.current_period_start
      WHERE u.is_oa_friend = TRUE
        AND (
          ${input.query}::text IS NULL
          OR u.id::text = ${input.query}
          OR u.line_user_id ILIKE '%' || ${input.query} || '%'
          OR COALESCE(u.display_name, '') ILIKE '%' || ${input.query} || '%'
        )
        AND (${input.planCode}::text IS NULL OR COALESCE(subscription.plan_code, 'FREE') = ${input.planCode})
        AND (
          ${input.userType}::text IS NULL
          OR (${input.userType} = 'GROUP_ENABLED' AND EXISTS (
            SELECT 1 FROM worklog_sources owned WHERE owned.type = 'GROUP' AND owned.status = 'ACTIVE' AND owned.owner_user_id = u.id
          ))
          OR (${input.userType} = 'INDIVIDUAL' AND NOT EXISTS (
            SELECT 1 FROM worklog_sources owned WHERE owned.type = 'GROUP' AND owned.status = 'ACTIVE' AND owned.owner_user_id = u.id
          ))
        )
      ORDER BY
        CASE WHEN ${input.sortUpdated} = 'ASC' THEN u.updated_at END ASC,
        CASE WHEN ${input.sortUpdated} = 'DESC' THEN u.updated_at END DESC,
        u.id DESC
      LIMIT ${input.limit}
    `);
    return result.rows;
  }

  async userDetail(userId: number) {
    const [summary, ownedGroups, memberGroups, aiUsage, subscriptionHistory] = await Promise.all([
      this.db.execute(sql`
        SELECT
          u.id::text AS id,
          u.line_user_id,
          u.display_name,
          u.is_oa_friend,
          u.first_oa_added_at,
          u.last_interaction_at,
          u.created_at,
          u.updated_at,
          subscription.plan_code,
          subscription.status AS subscription_status,
          subscription.source AS subscription_source,
          subscription.effective_at,
          subscription.current_period_start,
          subscription.current_period_end,
          COALESCE(balance.allowance_units, plan.ai_allowance_units, 0)::text AS ai_allowance_units,
          COALESCE(balance.used_units, 0)::text AS ai_used_units,
          COALESCE(balance.reserved_units, 0)::text AS ai_reserved_units,
          GREATEST(COALESCE(balance.allowance_units, plan.ai_allowance_units, 0) - COALESCE(balance.used_units, 0) - COALESCE(balance.reserved_units, 0), 0)::text AS ai_remaining_units,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'TEXT')::text AS text_count,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'AUDIO')::text AS audio_count,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'IMAGE')::text AS image_count,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'FILE')::text AS file_count
        FROM worklog_users u
        LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
        LEFT JOIN worklog_subscription_plans plan ON plan.code = subscription.plan_code
        LEFT JOIN worklog_ai_quota_balances balance ON balance.user_id = u.id AND balance.period_start = subscription.current_period_start
        WHERE u.id = ${userId}
        LIMIT 1
      `),
      this.db.execute(sql`
        SELECT
          source.id::text AS source_id,
          source.line_group_id,
          source.status,
          source.owner_binding_method,
          source.owner_bound_at,
          source.updated_at,
          (SELECT COUNT(*) FROM worklog_source_members member WHERE member.source_id = source.id AND member.is_active = TRUE)::text AS active_members,
          (SELECT COUNT(*) FROM worklog_records record WHERE record.source_id = source.id)::text AS record_count,
          COALESCE((SELECT SUM(usage.ai_units_consumed) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::text AS ai_used_units
        FROM worklog_sources source
        WHERE source.type = 'GROUP' AND source.owner_user_id = ${userId}
        ORDER BY source.updated_at DESC
      `),
      this.db.execute(sql`
        SELECT source.id::text AS source_id, source.line_group_id, source.status, member.recording_enabled,
               member.first_seen_at, member.last_seen_at, member.updated_at
        FROM worklog_source_members member
        INNER JOIN worklog_sources source ON source.id = member.source_id
        WHERE member.user_id = ${userId} AND source.type = 'GROUP'
        ORDER BY member.updated_at DESC
      `),
      this.db.execute(sql`
        SELECT id::text AS id, source_id::text AS source_id, record_id::text AS record_id,
               provider, model, input_tokens, output_tokens, audio_input_units, image_input_units,
               ai_units_consumed, provider_cost_usd::text, provider_cost_twd::text, created_at,
               CASE WHEN charged_user_id = actor_user_id THEN 'PERSONAL_OR_OWNER' ELSE 'GROUP_MEMBER_ACTOR' END AS billing_relation
        FROM worklog_ai_usage_events
        WHERE actor_user_id = ${userId} OR charged_user_id = ${userId}
        ORDER BY created_at DESC, id DESC LIMIT 100
      `),
      this.db.execute(sql`
        SELECT id::text AS id, previous_plan_code, next_plan_code, source, actor, metadata, created_at
        FROM worklog_subscription_history WHERE user_id = ${userId}
        ORDER BY created_at DESC, id DESC LIMIT 100
      `),
    ]);
    const user = summary.rows[0];
    return user ? {
      user,
      ownedGroups: ownedGroups.rows,
      memberGroups: memberGroups.rows,
      aiUsage: aiUsage.rows,
      subscriptionHistory: subscriptionHistory.rows,
    } : null;
  }

  async groups(query: string | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT
        source.id::text AS id,
        source.line_group_id,
        source.status,
        source.owner_user_id::text AS owner_user_id,
        owner.display_name AS owner_display_name,
        source.owner_binding_method,
        COALESCE(subscription.plan_code, 'FREE') AS owner_plan_code,
        COALESCE(balance.allowance_units, plan.ai_allowance_units, 0)::text AS owner_ai_allowance_units,
        COALESCE(balance.used_units, 0)::text AS owner_ai_used_units,
        GREATEST(COALESCE(balance.allowance_units, plan.ai_allowance_units, 0) - COALESCE(balance.used_units, 0) - COALESCE(balance.reserved_units, 0), 0)::text AS owner_ai_remaining_units,
        (SELECT COUNT(*) FROM worklog_source_members member WHERE member.source_id = source.id AND member.is_active = TRUE)::text AS active_members,
        (SELECT COUNT(*) FROM worklog_records record WHERE record.source_id = source.id)::text AS record_count,
        COALESCE((SELECT SUM(usage.ai_units_consumed) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::text AS group_ai_used_units,
        COALESCE((SELECT SUM(usage.provider_cost_twd) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::text AS group_ai_cost_twd,
        source.updated_at
      FROM worklog_sources source
      LEFT JOIN worklog_users owner ON owner.id = source.owner_user_id
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = source.owner_user_id
      LEFT JOIN worklog_subscription_plans plan ON plan.code = subscription.plan_code
      LEFT JOIN worklog_ai_quota_balances balance ON balance.user_id = source.owner_user_id AND balance.period_start = subscription.current_period_start
      WHERE source.type = 'GROUP'
        AND (
          ${query}::text IS NULL
          OR source.id::text = ${query}
          OR COALESCE(source.line_group_id, '') ILIKE '%' || ${query} || '%'
          OR COALESCE(owner.display_name, '') ILIKE '%' || ${query} || '%'
          OR COALESCE(source.owner_user_id::text, '') = ${query}
        )
      ORDER BY source.updated_at DESC, source.id DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async groupDetail(sourceId: number) {
    const group = await this.db.execute(sql`
      SELECT
        source.id::text AS id,
        source.workspace_id::text AS workspace_id,
        source.line_group_id,
        source.status,
        source.owner_user_id::text AS owner_user_id,
        owner.display_name AS owner_display_name,
        source.owner_binding_method,
        source.owner_bound_at,
        source.subscription_owner_user_id::text AS subscription_owner_user_id,
        subscription.plan_code AS owner_plan_code,
        subscription.current_period_start,
        subscription.current_period_end,
        COALESCE(balance.allowance_units, plan.ai_allowance_units, 0)::text AS owner_ai_allowance_units,
        COALESCE(balance.used_units, 0)::text AS owner_ai_used_units,
        COALESCE(balance.reserved_units, 0)::text AS owner_ai_reserved_units,
        GREATEST(COALESCE(balance.allowance_units, plan.ai_allowance_units, 0) - COALESCE(balance.used_units, 0) - COALESCE(balance.reserved_units, 0), 0)::text AS owner_ai_remaining_units,
        source.created_at,
        source.updated_at
      FROM worklog_sources source
      LEFT JOIN worklog_users owner ON owner.id = source.owner_user_id
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = source.owner_user_id
      LEFT JOIN worklog_subscription_plans plan ON plan.code = subscription.plan_code
      LEFT JOIN worklog_ai_quota_balances balance ON balance.user_id = source.owner_user_id AND balance.period_start = subscription.current_period_start
      WHERE source.id = ${sourceId} AND source.type = 'GROUP'
      LIMIT 1
    `);
    const row = group.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const periodStart = nullableDate(row.current_period_start) ?? new Date('1970-01-01T00:00:00Z');
    const periodEnd = nullableDate(row.current_period_end) ?? new Date('9999-12-31T23:59:59Z');
    const [members, recentRecords, recentUsage] = await Promise.all([
      this.db.execute(sql`
        WITH records AS (
          SELECT author_user_id,
            COUNT(*) FILTER (WHERE input_type = 'TEXT')::bigint AS text_count,
            COUNT(*) FILTER (WHERE input_type = 'AUDIO')::bigint AS audio_count,
            COUNT(*) FILTER (WHERE input_type = 'IMAGE')::bigint AS image_count,
            COUNT(*) FILTER (WHERE input_type = 'FILE')::bigint AS file_count
          FROM worklog_records WHERE source_id = ${sourceId} AND author_user_id IS NOT NULL GROUP BY author_user_id
        ), usage AS (
          SELECT actor_user_id, SUM(ai_units_consumed)::bigint AS ai_used_units,
                 COALESCE(SUM(provider_cost_twd), 0) AS ai_cost_twd
          FROM worklog_ai_usage_events
          WHERE source_id = ${sourceId} AND created_at >= ${periodStart} AND created_at < ${periodEnd}
          GROUP BY actor_user_id
        )
        SELECT member.user_id::text AS user_id, profile.line_user_id, profile.display_name,
               member.is_active, member.recording_enabled, member.first_seen_at, member.last_seen_at,
               COALESCE(records.text_count, 0)::text AS text_count,
               COALESCE(records.audio_count, 0)::text AS audio_count,
               COALESCE(records.image_count, 0)::text AS image_count,
               COALESCE(records.file_count, 0)::text AS file_count,
               COALESCE(usage.ai_used_units, 0)::text AS ai_used_units,
               COALESCE(usage.ai_cost_twd, 0)::text AS ai_cost_twd,
               member.updated_at
        FROM worklog_source_members member
        INNER JOIN worklog_users profile ON profile.id = member.user_id
        LEFT JOIN records ON records.author_user_id = member.user_id
        LEFT JOIN usage ON usage.actor_user_id = member.user_id
        WHERE member.source_id = ${sourceId}
        ORDER BY member.is_active DESC, profile.display_name ASC NULLS LAST, member.user_id ASC
      `),
      this.db.execute(sql`
        SELECT id::text AS id, author_user_id::text AS author_user_id, input_type, category,
               normalized_summary, raw_text, source_timestamp, created_at
        FROM worklog_records WHERE source_id = ${sourceId}
        ORDER BY COALESCE(source_timestamp, created_at) DESC, id DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT id::text AS id, actor_user_id::text AS actor_user_id, charged_user_id::text AS charged_user_id,
               record_id::text AS record_id, provider, model, ai_units_consumed,
               provider_cost_usd::text, provider_cost_twd::text, created_at
        FROM worklog_ai_usage_events WHERE source_id = ${sourceId}
        ORDER BY created_at DESC, id DESC LIMIT 50
      `),
    ]);
    return { group: row, members: members.rows, recentRecords: recentRecords.rows, recentUsage: recentUsage.rows };
  }

  async plans() {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, code, display_name, price_twd::text, rank, enabled,
             ai_allowance_units, capabilities, created_at, updated_at
      FROM worklog_subscription_plans
      ORDER BY rank ASC, code ASC
    `);
    return result.rows;
  }

  async upsertPlan(input: AdminPlanInput, actorAdmin: string) {
    const capabilitiesJson = JSON.stringify(input.capabilities);
    const before = await this.db.execute(sql`SELECT * FROM worklog_subscription_plans WHERE code = ${input.code} LIMIT 1`);
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_subscription_plans (
          code, display_name, price_twd, rank, enabled, ai_allowance_units, capabilities, created_at, updated_at
        ) VALUES (
          ${input.code}, ${input.displayName}, ${input.priceTwd}, ${input.rank}, ${input.enabled},
          ${input.aiAllowanceUnits}, ${capabilitiesJson}::jsonb, NOW(), NOW()
        )
        ON CONFLICT (code) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          price_twd = EXCLUDED.price_twd,
          rank = EXCLUDED.rank,
          enabled = EXCLUDED.enabled,
          ai_allowance_units = EXCLUDED.ai_allowance_units,
          capabilities = EXCLUDED.capabilities,
          updated_at = NOW()
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (actor_admin, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${actorAdmin}, 'PLAN_UPSERTED', 'SUBSCRIPTION_PLAN', changed.code,
               ${JSON.stringify(before.rows[0] ?? null)}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows[0] ?? null;
  }

  async aiRuntimeConfig() {
    const result = await this.db.execute(sql`
      SELECT id, provider, model, input_usd_per_million::text, output_usd_per_million::text,
             audio_usd_per_million::text, image_usd_per_million::text, usd_twd_rate::text,
             updated_by, created_at, updated_at
      FROM worklog_ai_runtime_config WHERE id = 1 LIMIT 1
    `);
    return result.rows[0] ?? null;
  }

  async updateAiRuntimeConfig(input: AdminAiRuntimeInput, actorAdmin: string) {
    const before = await this.aiRuntimeConfig();
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_ai_runtime_config (
          id, provider, model, input_usd_per_million, output_usd_per_million,
          audio_usd_per_million, image_usd_per_million, usd_twd_rate,
          updated_by, created_at, updated_at
        ) VALUES (
          1, ${input.provider}, ${input.model}, ${input.inputUsdPerMillion}, ${input.outputUsdPerMillion},
          ${input.audioUsdPerMillion}, ${input.imageUsdPerMillion}, ${input.usdTwdRate},
          ${actorAdmin}, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          input_usd_per_million = EXCLUDED.input_usd_per_million,
          output_usd_per_million = EXCLUDED.output_usd_per_million,
          audio_usd_per_million = EXCLUDED.audio_usd_per_million,
          image_usd_per_million = EXCLUDED.image_usd_per_million,
          usd_twd_rate = EXCLUDED.usd_twd_rate,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (actor_admin, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${actorAdmin}, 'AI_RUNTIME_CONFIG_UPDATED', 'AI_RUNTIME_CONFIG', '1',
               ${JSON.stringify(before)}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows[0] ?? null;
  }

  async feedback(limit: number) {
    const result = await this.db.execute(sql`
      SELECT feedback.id::text AS id, feedback.user_id::text AS user_id,
             COALESCE(feedback.display_name_snapshot, profile.display_name) AS display_name,
             feedback.channel, feedback.text, feedback.context, feedback.created_at
      FROM worklog_feedback feedback
      LEFT JOIN worklog_users profile ON profile.id = feedback.user_id
      ORDER BY feedback.created_at DESC, feedback.id DESC LIMIT ${limit}
    `);
    return result.rows;
  }

  async anomalies(limit: number) {
    const [events, attachments, normalizations] = await Promise.all([
      this.db.execute(sql`
        SELECT id::text AS id, category, severity, status, error_code, summary,
               user_id::text AS user_id, source_id::text AS source_id, line_message_id,
               request_ref, metadata, resolved_at, created_at, updated_at
        FROM worklog_anomaly_events
        ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT ${limit}
      `),
      this.db.execute(sql`
        SELECT command_line_message_id, quoted_line_message_id, source_id::text AS source_id,
               actor_user_id::text AS actor_user_id, status, last_error_code, created_at, updated_at
        FROM worklog_attachment_ingestions WHERE status = 'FAILED'
        ORDER BY updated_at DESC LIMIT ${limit}
      `),
      this.db.execute(sql`
        SELECT record_id::text AS record_id, status, last_error_code, last_error_detail,
               started_at, updated_at
        FROM worklog_record_ai_normalizations WHERE status = 'FAILED'
        ORDER BY updated_at DESC LIMIT ${limit}
      `),
    ]);
    return { events: events.rows, attachments: attachments.rows, normalizations: normalizations.rows };
  }

  async setAnomalyStatus(id: number, status: 'OPEN' | 'RESOLVED' | 'IGNORED', actorAdmin: string) {
    const before = await this.db.execute(sql`SELECT * FROM worklog_anomaly_events WHERE id = ${id} LIMIT 1`);
    if (before.rows.length === 0) return null;
    const result = await this.db.execute(sql`
      WITH changed AS (
        UPDATE worklog_anomaly_events
        SET status = ${status}, resolved_at = CASE WHEN ${status} = 'RESOLVED' THEN NOW() ELSE NULL END, updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (actor_admin, action, target_type, target_id, before_value, after_value, created_at)
        SELECT ${actorAdmin}, 'ANOMALY_STATUS_UPDATED', 'ANOMALY', changed.id::text,
               ${JSON.stringify(before.rows[0])}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.* FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    return result.rows[0] ?? null;
  }

  async audit(limit: number) {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, workspace_id::text AS workspace_id, actor_user_id::text AS actor_user_id,
             actor_admin, action, target_type, target_id, before_value, after_value, created_at
      FROM worklog_audit_logs ORDER BY created_at DESC, id DESC LIMIT ${limit}
    `);
    return result.rows;
  }
}

function taipeiDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
