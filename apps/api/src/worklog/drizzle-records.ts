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
  title: string | null;
  author_user_id: string | null;
  input_type: WorklogRecordListItem['inputType'];
  raw_text: string;
  occurred_at: Date | string | null;
  status: WorklogRecordListItem['status'];
  version: number;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class DrizzleWorklogRecordReadRepository implements WorklogRecordReadRepository {
  constructor(private readonly db: Database) {}

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
      SELECT source.id::text AS source_id,
             btrim(source.name) AS name,
             member.role
      FROM worklog_source_members AS member
      INNER JOIN worklog_sources AS source ON source.id = member.source_id
      WHERE member.user_id = ${userId}
        AND member.is_active = TRUE
        AND source.type = 'GROUP'
        AND source.status = 'ACTIVE'
        AND source.name IS NOT NULL
        AND length(btrim(source.name)) > 0
      ORDER BY source.updated_at DESC, source.id DESC
    `);
    return (result.rows as Array<{ source_id: string; name: string; role: 'OWNER' | 'MEMBER' }>).map((row) => ({
      sourceId: Number(row.source_id),
      name: row.name,
      role: row.role,
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
      SELECT record.id::text AS id,
             record.source_id::text AS source_id,
             record.title,
             record.author_user_id::text AS author_user_id,
             record.input_type,
             record.raw_text,
             record.occurred_at,
             record.status,
             record.version,
             record.deleted_at,
             record.created_at,
             record.updated_at
      FROM worklog_records AS record
      WHERE record.source_id = ${sourceId}
        AND record.status = 'ACTIVE'
      ORDER BY COALESCE(record.occurred_at, record.created_at) DESC, record.id DESC
      LIMIT ${limit}
    `);
    return (result.rows as RecordRow[]).map((row) => ({
      id: Number(row.id),
      sourceId: Number(row.source_id),
      title: row.title,
      authorUserId: nullableNumber(row.author_user_id),
      inputType: row.input_type,
      rawText: row.raw_text,
      occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
      status: row.status,
      version: Number(row.version),
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
