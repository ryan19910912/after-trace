import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { DrizzleWorklogLineTextCacheRepository } from './drizzle-line-text-cache';
import type { CachedLineText } from './line-text-cache';
import type {
  StoredTextRecordIdentity,
  WorklogGroupSurface,
  WorklogRecordListItem,
  WorklogRecordReadRepository,
  WorklogRecordWriteRepository,
  WorklogReplyEditTarget,
  WorklogReplyEditTargetResolution,
} from './records';

type RecordRow = {
  id: string;
  source_id: string;
  entity_id: string | null;
  title: string | null;
  author_user_id: string | null;
  input_type: WorklogRecordListItem['inputType'];
  raw_text: string;
  occurred_at: Date | string;
  status: WorklogRecordListItem['status'];
  version: number;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TextWriteRow = {
  id: string;
  source_id: string;
  author_user_id: string | null;
  line_message_id: string;
  quoted_line_message_id: string | null;
  raw_text: string;
  inserted: boolean;
};

type ReplyEditTargetRow = {
  id: string;
  source_id: string;
  author_user_id: string | null;
  entity_id: string | null;
  raw_text: string;
  occurred_at: Date | string;
  status: 'ACTIVE' | 'DELETED';
  version: number;
};

export class DrizzleWorklogRecordWriteRepository implements WorklogRecordWriteRepository {
  private readonly lineTextCache: DrizzleWorklogLineTextCacheRepository;

  constructor(private readonly db: Database) {
    this.lineTextCache = new DrizzleWorklogLineTextCacheRepository(db);
  }

  async upsert(input: CachedLineText): Promise<void> { return this.lineTextCache.upsert(input); }
  async pruneGroup(lineGroupId: string, keepNewest: number, now: Date): Promise<void> { return this.lineTextCache.pruneGroup(lineGroupId, keepNewest, now); }
  async findActive(lineGroupId: string, lineMessageId: string, now: Date): Promise<CachedLineText | null> { return this.lineTextCache.findActive(lineGroupId, lineMessageId, now); }

  async insertTextRecord(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    quotedLineMessageId?: string | null;
    rawText: string;
    occurredAt: Date;
  }): Promise<
    | { status: 'CREATED'; record: StoredTextRecordIdentity }
    | { status: 'EXISTING'; record: StoredTextRecordIdentity }
    | { status: 'SOURCE_NOT_FOUND' }
  > {
    const result = await this.db.execute(sql`
      WITH active_source AS (
        SELECT id FROM worklog_sources
        WHERE id = ${input.sourceId} AND status = 'ACTIVE' LIMIT 1
      ), inserted AS (
        INSERT INTO worklog_records (
          source_id, entity_id, author_user_id, line_message_id,
          quoted_line_message_id, input_type, raw_text, occurred_at,
          status, version, created_at, updated_at
        )
        SELECT active_source.id, NULL, ${input.authorUserId},
               ${input.lineMessageId}, ${input.quotedLineMessageId ?? null},
               'TEXT', ${input.rawText}, ${input.occurredAt},
               'ACTIVE', 1, NOW(), NOW()
        FROM active_source
        ON CONFLICT (line_message_id) DO NOTHING
        RETURNING id, source_id, author_user_id, line_message_id, quoted_line_message_id, raw_text
      )
      SELECT id::text AS id, source_id::text AS source_id,
             author_user_id::text AS author_user_id, line_message_id,
             quoted_line_message_id, raw_text, TRUE AS inserted
      FROM inserted
      UNION ALL
      SELECT existing.id::text AS id, existing.source_id::text AS source_id,
             existing.author_user_id::text AS author_user_id, existing.line_message_id,
             existing.quoted_line_message_id, existing.raw_text, FALSE AS inserted
      FROM worklog_records AS existing
      WHERE existing.line_message_id = ${input.lineMessageId}
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `);

    const row = result.rows[0] as TextWriteRow | undefined;
    if (row) {
      const record = textRecordIdentity(row);
      return row.inserted ? { status: 'CREATED', record } : { status: 'EXISTING', record };
    }

    const replay = await this.db.execute(sql`
      SELECT id::text AS id, source_id::text AS source_id,
             author_user_id::text AS author_user_id, line_message_id,
             quoted_line_message_id, raw_text, FALSE AS inserted
      FROM worklog_records
      WHERE line_message_id = ${input.lineMessageId}
      LIMIT 1
    `);
    const replayRow = replay.rows[0] as TextWriteRow | undefined;
    if (replayRow) return { status: 'EXISTING', record: textRecordIdentity(replayRow) };
    return { status: 'SOURCE_NOT_FOUND' };
  }

  async rememberBotReplyTarget(recordId: number, botLineMessageId: string): Promise<void> {
    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_line_record_reply_targets (
        record_id,
        bot_line_message_id,
        created_at
      )
      SELECT record.id, ${botLineMessageId}, NOW()
      FROM worklog_records AS record
      WHERE record.id = ${recordId}
      ON CONFLICT (bot_line_message_id) DO NOTHING
      RETURNING record_id::text AS record_id
    `);
    if (inserted.rows.length > 0) return;

    const existing = await this.db.execute(sql`
      SELECT record_id::text AS record_id
      FROM worklog_line_record_reply_targets
      WHERE bot_line_message_id = ${botLineMessageId}
      LIMIT 1
    `);
    const mappedRecordId = (existing.rows[0] as { record_id?: string } | undefined)?.record_id;
    if (!mappedRecordId) throw new Error('cannot map bot LINE reply to missing Record');
    if (Number(mappedRecordId) !== recordId) {
      throw new Error('bot LINE reply message id already maps to a different Record');
    }
  }

  async resolveReplyEditTarget(
    sourceId: number,
    quotedLineMessageId: string,
  ): Promise<WorklogReplyEditTargetResolution> {
    const result = await this.db.execute(sql`
      SELECT record.id::text AS id,
             record.source_id::text AS source_id,
             record.author_user_id::text AS author_user_id,
             record.entity_id::text AS entity_id,
             record.raw_text,
             record.occurred_at,
             record.status,
             record.version
      FROM worklog_records AS record
      WHERE record.source_id = ${sourceId}
        AND (
          record.line_message_id = ${quotedLineMessageId}
          OR record.quoted_line_message_id = ${quotedLineMessageId}
          OR EXISTS (
            SELECT 1
            FROM worklog_line_record_reply_targets AS reply_target
            WHERE reply_target.record_id = record.id
              AND reply_target.bot_line_message_id = ${quotedLineMessageId}
          )
        )
      ORDER BY CASE WHEN record.status = 'ACTIVE' THEN 0 ELSE 1 END, record.id DESC
      LIMIT 3
    `);

    const rows = result.rows as ReplyEditTargetRow[];
    const activeRows = rows.filter((row) => row.status === 'ACTIVE');
    if (activeRows.length > 1) return { status: 'AMBIGUOUS' };
    if (activeRows.length === 1) return { status: 'FOUND', record: replyEditTarget(activeRows[0]) };
    return rows.length > 0 ? { status: 'DELETED' } : { status: 'NOT_FOUND' };
  }
}

export class DrizzleWorklogRecordReadRepository implements WorklogRecordReadRepository {
  constructor(private readonly db: Database) {}

  async isOaFriend(userId: number): Promise<boolean> {
    const result = await this.db.execute(sql`SELECT is_oa_friend FROM worklog_users WHERE id = ${userId} LIMIT 1`);
    return Boolean((result.rows[0] as { is_oa_friend?: boolean } | undefined)?.is_oa_friend);
  }

  async getActivePersonalSourceId(userId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id FROM worklog_sources
      WHERE type = 'PRIVATE' AND status = 'ACTIVE' AND private_user_id = ${userId}
      LIMIT 1
    `);
    const id = (result.rows[0] as { id?: string } | undefined)?.id;
    return id ? Number(id) : null;
  }

  /** Baseline GROUP PWA authorization is membership, not billing entitlement. */
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
      sourceId: Number(row.source_id), lineGroupId: row.line_group_id,
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
             record.entity_id::text AS entity_id,
             entity.name AS title,
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
      LEFT JOIN worklog_entities AS entity ON entity.id = record.entity_id
      WHERE record.source_id = ${sourceId}
        AND record.status = 'ACTIVE'
      ORDER BY record.occurred_at DESC, record.id DESC
      LIMIT ${limit}
    `);
    return (result.rows as RecordRow[]).map((row) => ({
      id: Number(row.id),
      sourceId: Number(row.source_id),
      entityId: nullableNumber(row.entity_id),
      title: row.title,
      authorUserId: nullableNumber(row.author_user_id),
      inputType: row.input_type,
      rawText: row.raw_text,
      occurredAt: new Date(row.occurred_at).toISOString(),
      status: row.status,
      version: Number(row.version),
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
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

function replyEditTarget(row: ReplyEditTargetRow): WorklogReplyEditTarget {
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    authorUserId: nullableNumber(row.author_user_id),
    entityId: nullableNumber(row.entity_id),
    rawText: row.raw_text,
    occurredAt: new Date(row.occurred_at).toISOString(),
    version: Number(row.version),
  };
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
