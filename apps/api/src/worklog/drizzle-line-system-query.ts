import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogGroupSystemState, WorklogLineSystemQueryRepository } from './line-system-query';

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
}
