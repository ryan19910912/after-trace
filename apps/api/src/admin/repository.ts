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
  aiPointsToday: number;
  platformSubsidizedPointsToday: number;
  aiCostTwdToday: string;
  platformSubsidizedCostTwdToday: string;
  openAnomalies: number;
  failedAttachments: number;
  failedNormalizations: number;
  feedback30d: number;
};

export type AdminUserQuery = {
  query: string | null;
  planCode: string | null;
  /** Compatibility request value; semantics are now AI-responsibility, not group ownership. */
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

/**
 * Stable Admin persistence that is unrelated to user/group live allowance reporting.
 *
 * User/group reporting lives in DrizzleGrantAdminRepository so this file cannot
 * accidentally reintroduce the retired aggregate quota / Source Owner model.
 */
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
        COALESCE((SELECT SUM(customer_points_charged) FROM worklog_ai_usage_events WHERE created_at >= ${dayStart}), 0)::bigint::text AS ai_points_today,
        COALESCE((SELECT SUM(platform_subsidized_points) FROM worklog_ai_usage_events WHERE created_at >= ${dayStart}), 0)::bigint::text AS platform_subsidized_points_today,
        COALESCE((SELECT SUM(provider_cost_twd) FROM worklog_ai_usage_events WHERE created_at >= ${dayStart}), 0)::text AS ai_cost_twd_today,
        COALESCE((SELECT SUM(platform_subsidized_cost_twd) FROM worklog_ai_usage_events WHERE created_at >= ${dayStart}), 0)::text AS platform_subsidized_cost_twd_today,
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
      aiPointsToday: numeric(row.ai_points_today),
      platformSubsidizedPointsToday: numeric(row.platform_subsidized_points_today),
      aiCostTwdToday: row.ai_cost_twd_today ?? '0',
      platformSubsidizedCostTwdToday: row.platform_subsidized_cost_twd_today ?? '0',
      openAnomalies: numeric(row.open_anomalies),
      failedAttachments: numeric(row.failed_attachments),
      failedNormalizations: numeric(row.failed_normalizations),
      feedback30d: numeric(row.feedback_30d),
    };
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
