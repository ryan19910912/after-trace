import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  StoredTextRecordIdentity,
  WorklogGroupSurface,
  WorklogRecordListItem,
  WorklogRecordReadRepository,
  WorklogRecordWriteRepository,
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

type TextWriteRow = {
  id: string;
  source_id: string;
  author_user_id: string | null;
  line_message_id: string;
  quoted_line_message_id: string | null;
  raw_text: string | null;
  inserted: boolean;
};

export class DrizzleWorklogRecordWriteRepository implements WorklogRecordWriteRepository {
  constructor(private readonly db: Database) {}

  async insertTextRecord(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    quotedLineMessageId?: string | null;
    rawText: string;
    sourceTimestamp: Date;
  }): Promise<
    | { status: 'CREATED'; record: StoredTextRecordIdentity }
    | { status: 'EXISTING'; record: StoredTextRecordIdentity }
    | { status: 'SOURCE_NOT_FOUND' }
  > {
    const result = await this.db.execute(sql`
      WITH active_source AS (
        SELECT id, workspace_id
        FROM worklog_sources
        WHERE id = ${input.sourceId}
          AND status = 'ACTIVE'
        LIMIT 1
      ), inserted AS (
        INSERT INTO worklog_records (
          workspace_id,
          source_id,
          author_user_id,
          line_message_id,
          quoted_line_message_id,
          input_type,
          category,
          raw_text,
          source_timestamp,
          created_at,
          updated_at
        )
        SELECT
          active_source.workspace_id,
          active_source.id,
          ${input.authorUserId},
          ${input.lineMessageId},
          ${input.quotedLineMessageId ?? null},
          'TEXT',
          'OTHER',
          ${input.rawText},
          ${input.sourceTimestamp},
          NOW(),
          NOW()
        FROM active_source
        ON CONFLICT (line_message_id) DO NOTHING
        RETURNING id, source_id, author_user_id, line_message_id, quoted_line_message_id, raw_text
      )
      SELECT
        id::text AS id,
        source_id::text AS source_id,
        author_user_id::text AS author_user_id,
        line_message_id,
        quoted_line_message_id,
        raw_text,
        TRUE AS inserted
      FROM inserted
      UNION ALL
      SELECT
        existing.id::text AS id,
        existing.source_id::text AS source_id,
        existing.author_user_id::text AS author_user_id,
        existing.line_message_id,
        existing.quoted_line_message_id,
        existing.raw_text,
        FALSE AS inserted
      FROM worklog_records AS existing
      WHERE existing.line_message_id = ${input.lineMessageId}
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `);

    const row = result.rows[0] as TextWriteRow | undefined;
    if (row) {
      const record = textRecordIdentity(row);
      return row.inserted
        ? { status: 'CREATED', record }
        : { status: 'EXISTING', record };
    }

    const replay = await this.db.execute(sql`
      SELECT
        id::text AS id,
        source_id::text AS source_id,
        author_user_id::text AS author_user_id,
        line_message_id,
        quoted_line_message_id,
        raw_text,
        FALSE AS inserted
      FROM worklog_records
      WHERE line_message_id = ${input.lineMessageId}
      LIMIT 1
    `);
    const replayRow = replay.rows[0] as TextWriteRow | undefined;
    if (replayRow) return { status: 'EXISTING', record: textRecordIdentity(replayRow) };
    return { status: 'SOURCE_NOT_FOUND' };
  }
}

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

function textRecordIdentity(row: TextWriteRow): StoredTextRecordIdentity {
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    authorUserId: nullableNumber(row.author_user_id),
    lineMessageId: row.line_message_id,
    quotedLineMessageId: row.quoted_line_message_id,
    rawText: row.raw_text,
  };
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
