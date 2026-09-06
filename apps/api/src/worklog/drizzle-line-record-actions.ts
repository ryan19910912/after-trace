import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogLineActionTarget,
  WorklogLineActionTargetResolution,
  WorklogLineRecordActionRepository,
  WorklogLineRecordActionResult,
} from './line-record-actions';

type TargetRow = {
  id: string | number;
  source_id: string | number;
  author_user_id: string | number | null;
  entity_id: string | number | null;
  raw_text: string;
  occurred_at: Date | string;
  status: 'ACTIVE' | 'DELETED';
  version: string | number;
};

type CandidateRow = { entity_id: string | number; name: string };

export class DrizzleWorklogLineRecordActionRepository implements WorklogLineRecordActionRepository {
  constructor(private readonly db: Database) {}

  async resolveTarget(sourceId: number, quotedLineMessageId: string): Promise<WorklogLineActionTargetResolution> {
    const result = await this.db.execute(sql`
      SELECT record.id::text AS id,
             record.source_id::text AS source_id,
             record.author_user_id::text AS author_user_id,
             record.entity_id::text AS entity_id,
             record.raw_text,
             record.occurred_at,
             record.status,
             record.version
      FROM worklog_records record
      WHERE record.source_id = ${sourceId}
        AND (
          record.line_message_id = ${quotedLineMessageId}
          OR record.quoted_line_message_id = ${quotedLineMessageId}
          OR EXISTS (
            SELECT 1 FROM worklog_line_record_reply_targets target
            WHERE target.record_id = record.id
              AND target.bot_line_message_id = ${quotedLineMessageId}
          )
        )
      ORDER BY record.id DESC
      LIMIT 3
    `);
    const rows = result.rows as TargetRow[];
    if (rows.length === 0) return { status: 'NOT_FOUND' };
    if (rows.length > 1) return { status: 'AMBIGUOUS' };
    return { status: 'FOUND', record: target(rows[0]) };
  }

  async deleteRecord(target: WorklogLineActionTarget, actorUserId: number): Promise<WorklogLineRecordActionResult> {
    if (target.status !== 'ACTIVE') return { status: 'NOT_ACTIVE' };
    return this.mutateStatus(target, actorUserId, 'DELETED');
  }

  async restoreRecord(target: WorklogLineActionTarget, actorUserId: number): Promise<WorklogLineRecordActionResult> {
    if (target.status !== 'DELETED') return { status: 'NOT_DELETED' };
    return this.mutateStatus(target, actorUserId, 'ACTIVE');
  }

  async moveRecord(target: WorklogLineActionTarget, actorUserId: number, title: string): Promise<WorklogLineRecordActionResult> {
    if (target.status !== 'ACTIVE') return { status: 'NOT_ACTIVE' };
    const exact = await this.exactCandidates(target.sourceId, title);
    let entityId: number;
    if (exact.length > 1) return { status: 'AMBIGUOUS_TITLE' };
    if (exact.length === 1) entityId = exact[0];
    else {
      const fuzzy = await this.fuzzyCandidates(target.sourceId, title);
      if (fuzzy.length > 0) return { status: 'AMBIGUOUS_TITLE' };
      const created = await this.db.execute(sql`
        INSERT INTO worklog_entities (source_id, name, status, created_at, updated_at)
        VALUES (${target.sourceId}, ${title.trim().slice(0, 255)}, 'ACTIVE', NOW(), NOW())
        ON CONFLICT DO NOTHING
        RETURNING id::text AS id
      `);
      const createdId = (created.rows[0] as { id?: string } | undefined)?.id;
      if (createdId) entityId = Number(createdId);
      else {
        const retry = await this.exactCandidates(target.sourceId, title);
        if (retry.length !== 1) return { status: 'AMBIGUOUS_TITLE' };
        entityId = retry[0];
      }
    }

    if (target.entityId === entityId) return { status: 'MOVED', recordId: target.id, recordVersion: target.version };
    const nextVersion = target.version + 1;
    const result = await this.db.execute(sql`
      WITH updated AS (
        UPDATE worklog_records record
        SET entity_id = ${entityId}, version = ${nextVersion}, updated_at = NOW()
        WHERE record.id = ${target.id}
          AND record.source_id = ${target.sourceId}
          AND record.status = 'ACTIVE'
          AND record.version = ${target.version}
          AND EXISTS (
            SELECT 1 FROM worklog_entities entity
            WHERE entity.id = ${entityId}
              AND entity.source_id = record.source_id
              AND entity.status = 'ACTIVE'
          )
        RETURNING record.id
      ), revision AS (
        INSERT INTO worklog_record_revisions (
          record_id, version, editor_user_id, channel,
          previous_raw_text, new_raw_text,
          previous_occurred_at, new_occurred_at,
          previous_entity_id, new_entity_id,
          previous_status, new_status, created_at
        )
        SELECT ${target.id}, ${nextVersion}, ${actorUserId}, 'SYSTEM',
               ${target.rawText}, ${target.rawText}, ${new Date(target.occurredAt)}, ${new Date(target.occurredAt)},
               ${target.entityId}, ${entityId}, 'ACTIVE', 'ACTIVE', NOW()
        FROM updated
        RETURNING id
      )
      SELECT id FROM updated LIMIT 1
    `);
    return result.rows.length === 1
      ? { status: 'MOVED', recordId: target.id, recordVersion: nextVersion }
      : { status: 'VERSION_CONFLICT' };
  }

  private async mutateStatus(target: WorklogLineActionTarget, actorUserId: number, nextStatus: 'ACTIVE' | 'DELETED'): Promise<WorklogLineRecordActionResult> {
    const nextVersion = target.version + 1;
    const deletedAt = nextStatus === 'DELETED' ? new Date() : null;
    const result = await this.db.execute(sql`
      WITH updated AS (
        UPDATE worklog_records record
        SET status = ${nextStatus},
            version = ${nextVersion},
            deleted_at = ${deletedAt},
            deleted_by_user_id = ${nextStatus === 'DELETED' ? actorUserId : null},
            updated_at = NOW()
        WHERE record.id = ${target.id}
          AND record.source_id = ${target.sourceId}
          AND record.status = ${target.status}
          AND record.version = ${target.version}
        RETURNING record.id
      ), revision AS (
        INSERT INTO worklog_record_revisions (
          record_id, version, editor_user_id, channel,
          previous_raw_text, new_raw_text,
          previous_occurred_at, new_occurred_at,
          previous_entity_id, new_entity_id,
          previous_status, new_status, created_at
        )
        SELECT ${target.id}, ${nextVersion}, ${actorUserId}, 'SYSTEM',
               ${target.rawText}, ${target.rawText}, ${new Date(target.occurredAt)}, ${new Date(target.occurredAt)},
               ${target.entityId}, ${target.entityId}, ${target.status}, ${nextStatus}, NOW()
        FROM updated
        RETURNING id
      )
      SELECT id FROM updated LIMIT 1
    `);
    if (result.rows.length !== 1) return { status: 'VERSION_CONFLICT' };
    return nextStatus === 'DELETED'
      ? { status: 'DELETED', recordId: target.id, recordVersion: nextVersion }
      : { status: 'RESTORED', recordId: target.id, recordVersion: nextVersion };
  }

  private async exactCandidates(sourceId: number, title: string): Promise<number[]> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT candidate.entity_id::text AS entity_id
      FROM (
        SELECT entity.id AS entity_id
        FROM worklog_entities entity
        WHERE entity.source_id = ${sourceId}
          AND entity.status = 'ACTIVE'
          AND LOWER(BTRIM(entity.name)) = LOWER(BTRIM(${title}))
        UNION ALL
        SELECT alias.entity_id
        FROM worklog_entity_aliases alias
        INNER JOIN worklog_entities entity ON entity.id = alias.entity_id AND entity.source_id = alias.source_id AND entity.status = 'ACTIVE'
        WHERE alias.source_id = ${sourceId}
          AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(${title}))
      ) candidate
      LIMIT 3
    `);
    return (result.rows as CandidateRow[]).map((row) => Number(row.entity_id));
  }

  private async fuzzyCandidates(sourceId: number, title: string): Promise<number[]> {
    if (Array.from(title.trim()).length < 3) return [];
    const result = await this.db.execute(sql`
      SELECT DISTINCT entity.id::text AS entity_id, entity.name
      FROM worklog_entities entity
      LEFT JOIN worklog_entity_aliases alias ON alias.entity_id = entity.id AND alias.source_id = entity.source_id
      WHERE entity.source_id = ${sourceId}
        AND entity.status = 'ACTIVE'
        AND (
          POSITION(LOWER(${title}) IN LOWER(entity.name)) > 0
          OR POSITION(LOWER(entity.name) IN LOWER(${title})) > 0
          OR (alias.alias IS NOT NULL AND (POSITION(LOWER(${title}) IN LOWER(alias.alias)) > 0 OR POSITION(LOWER(alias.alias) IN LOWER(${title})) > 0))
        )
      LIMIT 3
    `);
    return (result.rows as CandidateRow[]).map((row) => Number(row.entity_id));
  }
}

function target(row: TargetRow): WorklogLineActionTarget {
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    authorUserId: row.author_user_id == null ? null : Number(row.author_user_id),
    entityId: row.entity_id == null ? null : Number(row.entity_id),
    rawText: row.raw_text,
    occurredAt: new Date(row.occurred_at).toISOString(),
    status: row.status,
    version: Number(row.version),
  };
}
