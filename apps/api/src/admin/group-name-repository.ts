import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { DrizzleGrantAdminRepository } from './grant-repository';

/** Admin repository extension that enriches GROUP list rows with cached LINE-owned group names. */
export class DrizzleGroupNameAdminRepository extends DrizzleGrantAdminRepository {
  constructor(private readonly database: Database) {
    super(database);
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
