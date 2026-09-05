import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  DrizzleAdminRepository,
  type AdminAiRuntimeInput,
  type AdminPlanInput,
  type AdminUserQuery,
} from './repository';

/** Grant-aware Admin repository; plan state never substitutes for Grant eligibility. */
export class DrizzleGrantAdminRepository {
  private readonly legacy: DrizzleAdminRepository;

  constructor(private readonly db: Database) {
    this.legacy = new DrizzleAdminRepository(db);
  }

  overview(at = new Date()) { return this.legacy.overview(at); }

  async users(input: AdminUserQuery) {
    const result = await this.db.execute(sql`
      SELECT
        u.id::text AS id,
        u.line_user_id,
        u.display_name,
        u.is_oa_friend,
        COALESCE(subscription.plan_code, 'FREE') AS plan_code,
        subscription.status AS subscription_status,
        COALESCE((SELECT SUM(grant.original_points) FROM worklog_ai_grants grant WHERE grant.owner_user_id = u.id AND grant.status <> 'REVOKED'), 0)::bigint::text AS ai_granted_points,
        COALESCE((SELECT SUM(grant.remaining_points) FROM worklog_ai_grants grant WHERE grant.owner_user_id = u.id AND grant.status IN ('ACTIVE','EXHAUSTED') AND grant.effective_at <= NOW() AND (grant.expires_at IS NULL OR grant.expires_at > NOW())), 0)::bigint::text AS ai_available_points,
        COALESCE((SELECT SUM(reservation.points_reserved - reservation.points_committed) FROM worklog_ai_point_reservations reservation WHERE reservation.charged_user_id = u.id AND reservation.status = 'RESERVED'), 0)::bigint::text AS ai_reserved_points,
        COALESCE((SELECT SUM(usage.customer_points_charged) FROM worklog_ai_usage_events usage WHERE usage.charged_user_id = u.id), 0)::bigint::text AS ai_used_points,
        COALESCE((SELECT SUM(usage.platform_subsidized_points) FROM worklog_ai_usage_events usage WHERE usage.charged_user_id = u.id), 0)::bigint::text AS platform_subsidized_points,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'TEXT')::text AS text_count,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'AUDIO')::text AS audio_count,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'IMAGE')::text AS image_count,
        (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'FILE')::text AS file_count,
        (SELECT COUNT(*) FROM worklog_source_ai_responsibility responsibility INNER JOIN worklog_sources source ON source.id = responsibility.source_id WHERE responsibility.responsible_user_id = u.id AND source.type = 'GROUP' AND source.status = 'ACTIVE')::text AS responsible_group_count,
        (SELECT COUNT(*) FROM worklog_source_members member INNER JOIN worklog_sources source ON source.id = member.source_id WHERE member.user_id = u.id AND member.is_active = TRUE AND source.type = 'GROUP' AND source.status = 'ACTIVE')::text AS member_group_count,
        CASE WHEN EXISTS (SELECT 1 FROM worklog_source_ai_responsibility responsibility INNER JOIN worklog_sources source ON source.id = responsibility.source_id WHERE responsibility.responsible_user_id = u.id AND source.type = 'GROUP' AND source.status = 'ACTIVE') THEN 'AI_RESPONSIBLE' ELSE 'INDIVIDUAL' END AS user_type,
        u.last_interaction_at,
        u.updated_at
      FROM worklog_users u
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
      WHERE u.is_oa_friend = TRUE
        AND (${input.query}::text IS NULL OR u.id::text = ${input.query}::text OR u.line_user_id ILIKE '%' || ${input.query}::text || '%' OR COALESCE(u.display_name, '') ILIKE '%' || ${input.query}::text || '%')
        AND (${input.planCode}::text IS NULL OR COALESCE(subscription.plan_code, 'FREE') = ${input.planCode}::text)
        AND (
          ${input.userType}::text IS NULL
          OR (${input.userType}::text = 'GROUP_ENABLED' AND EXISTS (SELECT 1 FROM worklog_source_ai_responsibility responsibility INNER JOIN worklog_sources source ON source.id = responsibility.source_id WHERE responsibility.responsible_user_id = u.id AND source.type = 'GROUP' AND source.status = 'ACTIVE'))
          OR (${input.userType}::text = 'INDIVIDUAL' AND NOT EXISTS (SELECT 1 FROM worklog_source_ai_responsibility responsibility INNER JOIN worklog_sources source ON source.id = responsibility.source_id WHERE responsibility.responsible_user_id = u.id AND source.type = 'GROUP' AND source.status = 'ACTIVE'))
        )
      ORDER BY CASE WHEN ${input.sortUpdated}::text = 'ASC' THEN u.updated_at END ASC,
               CASE WHEN ${input.sortUpdated}::text = 'DESC' THEN u.updated_at END DESC,
               u.id DESC
      LIMIT ${input.limit}
    `);
    return result.rows;
  }

  async userDetail(userId: number) {
    const [summary, grants, responsibleGroups, memberGroups, aiUsage, subscriptionHistory] = await Promise.all([
      this.db.execute(sql`
        SELECT
          u.id::text AS id, u.line_user_id, u.display_name, u.is_oa_friend,
          u.first_oa_added_at, u.last_interaction_at, u.created_at, u.updated_at,
          subscription.plan_code, subscription.status AS subscription_status,
          subscription.source AS subscription_source, subscription.effective_at,
          subscription.current_period_start, subscription.current_period_end,
          COALESCE((SELECT SUM(g.original_points) FROM worklog_ai_grants g WHERE g.owner_user_id = u.id AND g.status <> 'REVOKED'), 0)::bigint::text AS ai_granted_points,
          COALESCE((SELECT SUM(g.remaining_points) FROM worklog_ai_grants g WHERE g.owner_user_id = u.id AND g.status IN ('ACTIVE','EXHAUSTED') AND g.effective_at <= NOW() AND (g.expires_at IS NULL OR g.expires_at > NOW())), 0)::bigint::text AS ai_available_points,
          COALESCE((SELECT SUM(r.points_reserved - r.points_committed) FROM worklog_ai_point_reservations r WHERE r.charged_user_id = u.id AND r.status = 'RESERVED'), 0)::bigint::text AS ai_reserved_points,
          COALESCE((SELECT SUM(e.customer_points_charged) FROM worklog_ai_usage_events e WHERE e.charged_user_id = u.id), 0)::bigint::text AS ai_used_points,
          COALESCE((SELECT SUM(e.platform_subsidized_points) FROM worklog_ai_usage_events e WHERE e.charged_user_id = u.id), 0)::bigint::text AS platform_subsidized_points,
          COALESCE((SELECT SUM(e.provider_cost_twd) FROM worklog_ai_usage_events e WHERE e.charged_user_id = u.id), 0)::text AS provider_cost_twd,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'TEXT')::text AS text_count,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'AUDIO')::text AS audio_count,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'IMAGE')::text AS image_count,
          (SELECT COUNT(*) FROM worklog_records r WHERE r.author_user_id = u.id AND r.input_type = 'FILE')::text AS file_count
        FROM worklog_users u
        LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
        WHERE u.id = ${userId}
        LIMIT 1
      `),
      this.db.execute(sql`
        SELECT grant.id::text AS id, grant.type, grant.status,
               grant.original_points, grant.remaining_points, grant.effective_at,
               grant.expires_at, grant.origin_key, grant.metadata,
               COALESCE((SELECT SUM(scope.used_points) FROM worklog_ai_grant_scopes scope WHERE scope.grant_id = grant.id), 0)::bigint::text AS scoped_used_points,
               COALESCE((SELECT SUM(scope.reserved_points) FROM worklog_ai_grant_scopes scope WHERE scope.grant_id = grant.id), 0)::bigint::text AS scoped_reserved_points,
               (SELECT COUNT(*) FROM worklog_ai_grant_scopes scope WHERE scope.grant_id = grant.id AND scope.enabled = TRUE)::text AS enabled_source_count
        FROM worklog_ai_grants grant
        WHERE grant.owner_user_id = ${userId}
        ORDER BY grant.created_at DESC, grant.id DESC
      `),
      this.db.execute(sql`
        SELECT source.id::text AS source_id, source.line_group_id, source.status,
               responsibility.assigned_at, source.updated_at,
               (SELECT COUNT(*) FROM worklog_source_members member WHERE member.source_id = source.id AND member.is_active = TRUE)::text AS active_members,
               (SELECT COUNT(*) FROM worklog_records record WHERE record.source_id = source.id)::text AS record_count,
               COALESCE((SELECT SUM(usage.customer_points_charged) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS ai_used_points,
               COALESCE((SELECT SUM(usage.platform_subsidized_points) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS platform_subsidized_points
        FROM worklog_source_ai_responsibility responsibility
        INNER JOIN worklog_sources source ON source.id = responsibility.source_id
        WHERE source.type = 'GROUP' AND responsibility.responsible_user_id = ${userId}
        ORDER BY source.updated_at DESC
      `),
      this.db.execute(sql`
        SELECT source.id::text AS source_id, source.line_group_id, source.status,
               member.first_seen_at, member.last_seen_at, member.updated_at
        FROM worklog_source_members member
        INNER JOIN worklog_sources source ON source.id = member.source_id
        WHERE member.user_id = ${userId} AND source.type = 'GROUP'
        ORDER BY member.updated_at DESC
      `),
      this.db.execute(sql`
        SELECT id::text AS id, source_id::text AS source_id, record_id::text AS record_id,
               actor_user_id::text AS actor_user_id, charged_user_id::text AS charged_user_id,
               operation, provider, model, input_tokens, output_tokens, audio_input_units, image_input_units,
               customer_points_charged, platform_subsidized_points,
               provider_cost_usd::text, provider_cost_twd::text, created_at,
               CASE WHEN charged_user_id = actor_user_id THEN 'SELF' ELSE 'GROUP_ACTOR' END AS billing_relation
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
    return user ? { user, grants: grants.rows, responsibleGroups: responsibleGroups.rows, memberGroups: memberGroups.rows, aiUsage: aiUsage.rows, subscriptionHistory: subscriptionHistory.rows } : null;
  }

  async groups(query: string | null, limit: number) {
    const result = await this.db.execute(sql`
      SELECT
        source.id::text AS id,
        source.line_group_id,
        source.status,
        responsibility.responsible_user_id::text AS ai_responsible_user_id,
        responsible.display_name AS ai_responsible_display_name,
        COALESCE((
          SELECT SUM(LEAST(grant.remaining_points, CASE WHEN scope.cap_points IS NULL THEN grant.remaining_points ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points) END))
          FROM worklog_ai_grants grant
          INNER JOIN worklog_ai_grant_scopes scope ON scope.grant_id = grant.id
          WHERE responsibility.responsible_user_id IS NOT NULL
            AND grant.owner_user_id = responsibility.responsible_user_id
            AND scope.source_id = source.id AND scope.enabled = TRUE
            AND grant.status IN ('ACTIVE','EXHAUSTED') AND grant.effective_at <= NOW()
            AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
        ), 0)::bigint::text AS ai_available_points,
        COALESCE((
          SELECT SUM(scope.reserved_points)
          FROM worklog_ai_grant_scopes scope
          INNER JOIN worklog_ai_grants grant ON grant.id = scope.grant_id
          WHERE responsibility.responsible_user_id IS NOT NULL
            AND grant.owner_user_id = responsibility.responsible_user_id
            AND scope.source_id = source.id AND scope.enabled = TRUE
            AND grant.status IN ('ACTIVE','EXHAUSTED')
            AND grant.effective_at <= NOW()
            AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
        ), 0)::bigint::text AS ai_reserved_points,
        (SELECT COUNT(*) FROM worklog_source_members member WHERE member.source_id = source.id AND member.is_active = TRUE)::text AS active_members,
        (SELECT COUNT(*) FROM worklog_records record WHERE record.source_id = source.id)::text AS record_count,
        COALESCE((SELECT SUM(usage.customer_points_charged) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS group_ai_used_points,
        COALESCE((SELECT SUM(usage.platform_subsidized_points) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS platform_subsidized_points,
        COALESCE((SELECT SUM(usage.provider_cost_twd) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::text AS group_ai_cost_twd,
        source.updated_at
      FROM worklog_sources source
      LEFT JOIN worklog_source_ai_responsibility responsibility ON responsibility.source_id = source.id
      LEFT JOIN worklog_users responsible ON responsible.id = responsibility.responsible_user_id
      WHERE source.type = 'GROUP'
        AND (${query}::text IS NULL OR source.id::text = ${query}::text OR COALESCE(source.line_group_id, '') ILIKE '%' || ${query}::text || '%' OR COALESCE(responsible.display_name, '') ILIKE '%' || ${query}::text || '%' OR COALESCE(responsibility.responsible_user_id::text, '') = ${query}::text)
      ORDER BY source.updated_at DESC, source.id DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async groupDetail(sourceId: number) {
    const group = await this.db.execute(sql`
      SELECT
        source.id::text AS id,
        source.line_group_id,
        source.status,
        responsibility.responsible_user_id::text AS ai_responsible_user_id,
        responsible.display_name AS ai_responsible_display_name,
        responsibility.assigned_by_user_id::text AS responsibility_assigned_by_user_id,
        responsibility.assigned_at AS responsibility_assigned_at,
        COALESCE((
          SELECT SUM(LEAST(grant.remaining_points, CASE WHEN scope.cap_points IS NULL THEN grant.remaining_points ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points) END))
          FROM worklog_ai_grants grant
          INNER JOIN worklog_ai_grant_scopes scope ON scope.grant_id = grant.id
          WHERE responsibility.responsible_user_id IS NOT NULL
            AND grant.owner_user_id = responsibility.responsible_user_id
            AND scope.source_id = source.id AND scope.enabled = TRUE
            AND grant.status IN ('ACTIVE','EXHAUSTED') AND grant.effective_at <= NOW()
            AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
        ), 0)::bigint::text AS ai_available_points,
        COALESCE((
          SELECT SUM(scope.reserved_points)
          FROM worklog_ai_grant_scopes scope
          INNER JOIN worklog_ai_grants grant ON grant.id = scope.grant_id
          WHERE responsibility.responsible_user_id IS NOT NULL
            AND grant.owner_user_id = responsibility.responsible_user_id
            AND scope.source_id = source.id AND scope.enabled = TRUE
            AND grant.status IN ('ACTIVE','EXHAUSTED')
            AND grant.effective_at <= NOW()
            AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
        ), 0)::bigint::text AS ai_reserved_points,
        COALESCE((SELECT SUM(usage.customer_points_charged) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS ai_used_points,
        COALESCE((SELECT SUM(usage.platform_subsidized_points) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS platform_subsidized_points,
        source.created_at,
        source.updated_at
      FROM worklog_sources source
      LEFT JOIN worklog_source_ai_responsibility responsibility ON responsibility.source_id = source.id
      LEFT JOIN worklog_users responsible ON responsible.id = responsibility.responsible_user_id
      WHERE source.id = ${sourceId} AND source.type = 'GROUP'
      LIMIT 1
    `);
    const row = group.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const [members, recentRecords, recentUsage, fundingScopes, responsibilityHistory] = await Promise.all([
      this.db.execute(sql`
        WITH records AS (
          SELECT author_user_id,
            COUNT(*) FILTER (WHERE input_type = 'TEXT')::bigint AS text_count,
            COUNT(*) FILTER (WHERE input_type = 'AUDIO')::bigint AS audio_count,
            COUNT(*) FILTER (WHERE input_type = 'IMAGE')::bigint AS image_count,
            COUNT(*) FILTER (WHERE input_type = 'FILE')::bigint AS file_count
          FROM worklog_records WHERE source_id = ${sourceId} AND author_user_id IS NOT NULL GROUP BY author_user_id
        ), usage AS (
          SELECT actor_user_id,
                 COALESCE(SUM(customer_points_charged), 0)::bigint AS ai_used_points,
                 COALESCE(SUM(platform_subsidized_points), 0)::bigint AS platform_subsidized_points,
                 COALESCE(SUM(provider_cost_twd), 0) AS ai_cost_twd
          FROM worklog_ai_usage_events WHERE source_id = ${sourceId}
          GROUP BY actor_user_id
        )
        SELECT member.user_id::text AS user_id, profile.line_user_id, profile.display_name,
               member.is_active, member.first_seen_at, member.last_seen_at,
               COALESCE(records.text_count, 0)::text AS text_count,
               COALESCE(records.audio_count, 0)::text AS audio_count,
               COALESCE(records.image_count, 0)::text AS image_count,
               COALESCE(records.file_count, 0)::text AS file_count,
               COALESCE(usage.ai_used_points, 0)::text AS ai_used_points,
               COALESCE(usage.platform_subsidized_points, 0)::text AS platform_subsidized_points,
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
        SELECT record.id::text AS id, record.author_user_id::text AS author_user_id,
               author.display_name AS author_display_name, record.entity_id::text AS entity_id,
               entity.name AS title, record.input_type, record.raw_text, record.occurred_at,
               record.status, record.version, record.created_at, record.updated_at
        FROM worklog_records record
        LEFT JOIN worklog_users author ON author.id = record.author_user_id
        LEFT JOIN worklog_entities entity ON entity.id = record.entity_id
        WHERE record.source_id = ${sourceId}
        ORDER BY record.occurred_at DESC, record.id DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT id::text AS id, actor_user_id::text AS actor_user_id,
               charged_user_id::text AS charged_user_id, record_id::text AS record_id,
               operation, provider, model, customer_points_charged, platform_subsidized_points,
               provider_cost_usd::text, provider_cost_twd::text, created_at
        FROM worklog_ai_usage_events WHERE source_id = ${sourceId}
        ORDER BY created_at DESC, id DESC LIMIT 50
      `),
      this.db.execute(sql`
        SELECT scope.id::text AS scope_id, scope.grant_id::text AS grant_id,
               grant.owner_user_id::text AS owner_user_id, grant.type AS grant_type,
               scope.cap_points, scope.used_points, scope.reserved_points, scope.enabled,
               grant.remaining_points, grant.expires_at, scope.updated_at
        FROM worklog_ai_grant_scopes scope
        INNER JOIN worklog_ai_grants grant ON grant.id = scope.grant_id
        WHERE scope.source_id = ${sourceId}
        ORDER BY scope.updated_at DESC, scope.id DESC
      `),
      this.db.execute(sql`
        SELECT id::text AS id, previous_user_id::text AS previous_user_id,
               next_user_id::text AS next_user_id, actor_user_id::text AS actor_user_id,
               reason, created_at
        FROM worklog_source_ai_responsibility_history
        WHERE source_id = ${sourceId}
        ORDER BY created_at DESC, id DESC LIMIT 100
      `),
    ]);
    return { group: row, members: members.rows, recentRecords: recentRecords.rows, recentUsage: recentUsage.rows, fundingScopes: fundingScopes.rows, responsibilityHistory: responsibilityHistory.rows };
  }

  plans() { return this.legacy.plans(); }
  upsertPlan(input: AdminPlanInput, actorAdmin: string) { return this.legacy.upsertPlan(input, actorAdmin); }
  deletePlan(code: string, actorAdmin: string) { return this.legacy.deletePlan(code, actorAdmin); }
  aiRuntimeConfig() { return this.legacy.aiRuntimeConfig(); }
  updateAiRuntimeConfig(input: AdminAiRuntimeInput, actorAdmin: string) { return this.legacy.updateAiRuntimeConfig(input, actorAdmin); }
  feedback(limit: number) { return this.legacy.feedback(limit); }
  anomalies(limit: number) { return this.legacy.anomalies(limit); }
  setAnomalyStatus(id: number, status: 'OPEN' | 'RESOLVED' | 'IGNORED', actorAdmin: string) { return this.legacy.setAnomalyStatus(id, status, actorAdmin); }
  audit(limit: number) { return this.legacy.audit(limit); }
}
