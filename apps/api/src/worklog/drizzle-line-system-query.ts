import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAiAllowanceStatus,
  WorklogGroupSystemState,
  WorklogLineSystemQueryRepository,
} from './line-system-query';

export class DrizzleWorklogLineSystemQueryRepository implements WorklogLineSystemQueryRepository {
  constructor(private readonly db: Database) {}

  async groupState(sourceId: number): Promise<WorklogGroupSystemState | null> {
    const result = await this.db.execute(sql`
      SELECT source.id::text AS source_id,
             responsibility.responsible_user_id::text AS responsible_user_id,
             user_row.display_name AS responsible_display_name,
             user_row.line_user_id AS responsible_line_user_id
      FROM worklog_sources source
      LEFT JOIN worklog_source_ai_responsibility responsibility ON responsibility.source_id = source.id
      LEFT JOIN worklog_users user_row ON user_row.id = responsibility.responsible_user_id
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
        AND source.status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as {
      source_id?: string;
      responsible_user_id?: string | null;
      responsible_display_name?: string | null;
      responsible_line_user_id?: string | null;
    } | undefined;
    if (!row?.source_id) return null;
    return {
      responsibleUserId: row.responsible_user_id ? Number(row.responsible_user_id) : null,
      responsibleDisplayName: row.responsible_display_name ?? null,
      responsibleLineUserId: row.responsible_line_user_id ?? null,
    };
  }

  async allowance(ownerUserId: number, sourceId: number, at: Date): Promise<WorklogAiAllowanceStatus> {
    const result = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(
          LEAST(
            grant.original_points,
            CASE WHEN scope.cap_points IS NULL THEN grant.original_points ELSE scope.cap_points END
          )
        ), 0)::text AS total_points,
        COALESCE(SUM(
          LEAST(
            grant.remaining_points,
            CASE
              WHEN scope.cap_points IS NULL THEN grant.remaining_points
              ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
            END
          )
        ), 0)::text AS remaining_points
      FROM worklog_ai_grants grant
      INNER JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = grant.id
       AND scope.source_id = ${sourceId}
       AND scope.enabled = TRUE
      WHERE grant.owner_user_id = ${ownerUserId}
        AND grant.status IN ('ACTIVE', 'EXHAUSTED')
        AND grant.effective_at <= ${at}
        AND (grant.expires_at IS NULL OR grant.expires_at > ${at})
    `);
    const row = result.rows[0] as { total_points?: string; remaining_points?: string } | undefined;
    return {
      totalPoints: nonNegativeSafeInteger(row?.total_points),
      remainingPoints: nonNegativeSafeInteger(row?.remaining_points),
    };
  }
}

function nonNegativeSafeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
