import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { DrizzleGrantAdminRepository } from './grant-repository';
import type { AdminUserQuery } from './repository';

/**
 * Admin repository extension for current target-facing list behavior while legacy Admin
 * grant/group detail views are still being migrated.
 */
export class DrizzleGroupNameAdminRepository extends DrizzleGrantAdminRepository {
  constructor(private readonly database: Database) {
    super(database);
  }

  override async users(input: AdminUserQuery) {
    const result = await this.database.execute(sql`
      SELECT
        u.id::text AS id,
        public_account.public_account_id,
        u.line_user_id,
        u.display_name,
        u.is_oa_friend,
        COALESCE(subscription.plan_code, 'FREE') AS plan_code,
        subscription.status AS subscription_status,
        COALESCE((SELECT SUM(g.original_points) FROM worklog_ai_grants g WHERE g.owner_user_id = u.id AND g.status <> 'REVOKED'), 0)::bigint::text AS ai_granted_points,
        COALESCE((SELECT SUM(g.remaining_points) FROM worklog_ai_grants g WHERE g.owner_user_id = u.id AND g.status IN ('ACTIVE','EXHAUSTED') AND g.effective_at <= NOW() AND (g.expires_at IS NULL OR g.expires_at > NOW())), 0)::bigint::text AS ai_available_points,
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
      LEFT JOIN worklog_user_public_accounts public_account ON public_account.user_id = u.id
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
      WHERE (
          ${input.query}::text IS NULL
          OR u.id::text = ${input.query}::text
          OR public_account.public_account_id = UPPER(${input.query}::text)
          OR COALESCE(u.line_user_id, '') ILIKE '%' || ${input.query}::text || '%'
          OR COALESCE(u.display_name, '') ILIKE '%' || ${input.query}::text || '%'
        )
        AND (${input.planCode}::text IS NULL OR COALESCE(subscription.plan_code, 'FREE') = ${input.planCode}::text)
        AND (
          ${input.userType}::text IS NULL
          OR (${input.userType}::text = 'GROUP_ENABLED' AND EXISTS (SELECT 1 FROM worklog_source_ai_responsibility responsibility INNER JOIN worklog_sources source ON source.id = responsibility.source_id WHERE responsibility.responsible_user_id = u.id AND source.type = 'GROUP' AND source.status = 'ACTIVE'))
          OR (${input.userType}::text = 'INDIVIDUAL' AND NOT EXISTS (SELECT 1 FROM worklog_source_ai_responsibility responsibility INNER JOIN worklog_sources source ON source.id = responsibility.responsible_user_id AND source.type = 'GROUP' AND source.status = 'ACTIVE'))
        )
      ORDER BY CASE WHEN ${input.sortUpdated}::text = 'ASC' THEN u.updated_at END ASC,
               CASE WHEN ${input.sortUpdated}::text = 'DESC' THEN u.updated_at END DESC,
               u.id DESC
      LIMIT ${input.limit}
    `);
    return result.rows;
  }

  override async groups(query: string | null, limit: number) {
    const result = await this.database.execute(sql`
      SELECT
        source.id::text AS id,
        source.line_group_id,
        profile.group_name AS line_group_name,
        source.status,
        responsibility.responsible_user_id::text AS ai_responsible_user_id,
        responsible.display_name AS ai_responsible_display_name,
        COALESCE((
          SELECT SUM(LEAST(g.remaining_points, CASE WHEN scope.cap_points IS NULL THEN g.remaining_points ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points) END))
          FROM worklog_ai_grants g
          INNER JOIN worklog_ai_grant_scopes scope ON scope.grant_id = g.id
          WHERE responsibility.responsible_user_id IS NOT NULL
            AND g.owner_user_id = responsibility.responsible_user_id
            AND scope.source_id = source.id AND scope.enabled = TRUE
            AND g.status IN ('ACTIVE','EXHAUSTED') AND g.effective_at <= NOW()
            AND (g.expires_at IS NULL OR g.expires_at > NOW())
        ), 0)::bigint::text AS ai_available_points,
        COALESCE((
          SELECT SUM(scope.reserved_points)
          FROM worklog_ai_grant_scopes scope
          INNER JOIN worklog_ai_grants g ON g.id = scope.grant_id
          WHERE responsibility.responsible_user_id IS NOT NULL
            AND g.owner_user_id = responsibility.responsible_user_id
            AND scope.source_id = source.id AND scope.enabled = TRUE
            AND g.status IN ('ACTIVE','EXHAUSTED')
            AND g.effective_at <= NOW()
            AND (g.expires_at IS NULL OR g.expires_at > NOW())
        ), 0)::bigint::text AS ai_reserved_points,
        (SELECT COUNT(*) FROM worklog_source_members member WHERE member.source_id = source.id AND member.is_active = TRUE)::text AS active_members,
        (SELECT COUNT(*) FROM worklog_records record WHERE record.source_id = source.id)::text AS record_count,
        COALESCE((SELECT SUM(usage.customer_points_charged) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS group_ai_used_points,
        COALESCE((SELECT SUM(usage.platform_subsidized_points) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::bigint::text AS platform_subsidized_points,
        COALESCE((SELECT SUM(usage.provider_cost_twd) FROM worklog_ai_usage_events usage WHERE usage.source_id = source.id), 0)::text AS group_ai_cost_twd,
        source.updated_at
      FROM worklog_sources source
      LEFT JOIN worklog_source_line_profiles profile ON profile.source_id = source.id
      LEFT JOIN worklog_source_ai_responsibility responsibility ON responsibility.source_id = source.id
      LEFT JOIN worklog_users responsible ON responsible.id = responsibility.responsible_user_id
      WHERE source.type = 'GROUP'
        AND (
          ${query}::text IS NULL
          OR source.id::text = ${query}::text
          OR COALESCE(source.line_group_id, '') ILIKE '%' || ${query}::text || '%'
          OR COALESCE(profile.group_name, '') ILIKE '%' || ${query}::text || '%'
          OR COALESCE(responsible.display_name, '') ILIKE '%' || ${query}::text || '%'
          OR COALESCE(responsibility.responsible_user_id::text, '') = ${query}::text
        )
      ORDER BY source.updated_at DESC, source.id DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }
}
