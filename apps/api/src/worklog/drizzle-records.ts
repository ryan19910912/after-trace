import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogGroupSurface,
  WorklogRecordListItem,
  WorklogRecordReadRepository,
} from './records';

type RecordRow = {
  id: string;
  source_id: string;
  author_user_id: string | null;
  input_type: WorklogRecordListItem['inputType'];
  category: string;
  raw_text: string | null;
  normalized_summary: string | null;
  customer_id: string | null;
  project_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class DrizzleWorklogRecordReadRepository implements WorklogRecordReadRepository {
  constructor(private readonly db: Database) {}

  async isOaFriend(userId: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT is_oa_friend
      FROM worklog_users
      WHERE id = ${userId}
      LIMIT 1
    `);
    return Boolean((result.rows[0] as { is_oa_friend?: boolean } | undefined)?.is_oa_friend);
  }

  async getActivePersonalSourceId(userId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id
      FROM worklog_sources
      WHERE type = 'PRIVATE'
        AND status = 'ACTIVE'
        AND private_user_id = ${userId}
      LIMIT 1
    `);
    const id = (result.rows[0] as { id?: string } | undefined)?.id;
    return id ? Number(id) : null;
  }

  async listActiveGroupSurfaces(userId: number): Promise<WorklogGroupSurface[]> {
    const result = await this.db.execute(sql`
      SELECT source.id::text AS source_id, source.line_group_id
      FROM worklog_source_members AS member
      INNER JOIN worklog_sources AS source ON source.id = member.source_id
      WHERE member.user_id = ${userId}
        AND member.is_active = TRUE
        AND source.type = 'GROUP'
        AND source.status = 'ACTIVE'
        AND source.line_group_id IS NOT NULL
      ORDER BY source.updated_at DESC, source.id DESC
    `);
    return (result.rows as Array<{ source_id: string; line_group_id: string }>).map((row) => ({
      sourceId: Number(row.source_id),
      lineGroupId: row.line_group_id,
    }));
  }

  async isActiveGroupMember(userId: number, sourceId: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM worklog_source_members AS member
        INNER JOIN worklog_sources AS source ON source.id = member.source_id
        WHERE member.user_id = ${userId}
          AND member.source_id = ${sourceId}
          AND member.is_active = TRUE
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
      ) AS allowed
    `);
    return Boolean((result.rows[0] as { allowed?: boolean } | undefined)?.allowed);
  }

  async listRecordsBySource(sourceId: number, limit: number): Promise<WorklogRecordListItem[]> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        source_id::text AS source_id,
        author_user_id::text AS author_user_id,
        input_type,
        category,
        raw_text,
        normalized_summary,
        customer_id::text AS customer_id,
        project_id::text AS project_id,
        created_at,
        updated_at
      FROM worklog_records
      WHERE source_id = ${sourceId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `);
    return (result.rows as RecordRow[]).map((row) => ({
      id: Number(row.id),
      sourceId: Number(row.source_id),
      authorUserId: nullableNumber(row.author_user_id),
      inputType: row.input_type,
      category: row.category,
      rawText: row.raw_text,
      normalizedSummary: row.normalized_summary,
      customerId: nullableNumber(row.customer_id),
      projectId: nullableNumber(row.project_id),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
