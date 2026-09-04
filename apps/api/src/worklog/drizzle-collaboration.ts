import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  GroupManualAccessContext,
  WorklogCollaborationRepository,
} from './collaboration';

type ManualAccessRow = {
  source_id: string;
  source_status: 'ACTIVE' | 'INACTIVE';
  member_active: boolean | null;
};

/** GROUP collaboration persistence is manual membership only. AI funding is separate. */
export class DrizzleWorklogCollaborationRepository implements WorklogCollaborationRepository {
  constructor(private readonly db: Database) {}

  async getGroupManualAccessContext(
    sourceId: number,
    actorUserId: number,
  ): Promise<GroupManualAccessContext | null> {
    const result = await this.db.execute(sql`
      SELECT
        source.id::text AS source_id,
        source.status AS source_status,
        member.is_active AS member_active
      FROM worklog_sources AS source
      LEFT JOIN worklog_source_members AS member
        ON member.source_id = source.id
       AND member.user_id = ${actorUserId}
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
      LIMIT 1
    `);
    const row = result.rows[0] as ManualAccessRow | undefined;
    if (!row) return null;
    return {
      sourceId: Number(row.source_id),
      sourceStatus: row.source_status,
      actorIsActiveMember: row.member_active === true,
    };
  }
}
