import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ManagedMemory,
  ManagedReminder,
  ManagementRepository,
  MemoryUpdateInput,
} from './service';

type MemoryRow = {
  id: string;
  category: string;
  subject: string | null;
  content: string;
  source_message_id: string | null;
  source_line_user_id: string | null;
  source_line_timestamp: Date | string | null;
  source_quote_token: string | null;
  updated_at: Date | string;
};

type ReminderRow = {
  id: string;
  message: string;
  scheduled_for: Date | string;
  status: ManagedReminder['status'];
};

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function mapMemory(row: MemoryRow): ManagedMemory {
  return {
    id: Number(row.id),
    category: row.category,
    subject: row.subject,
    content: row.content,
    sourceMessageId: row.source_message_id,
    sourceLineUserId: row.source_line_user_id,
    sourceLineTimestamp: iso(row.source_line_timestamp),
    sourceQuoteToken: row.source_quote_token,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class DrizzleManagementRepository implements ManagementRepository {
  constructor(private readonly db: Database) {}

  async listMemories(groupId: number, query: string | null, limit: number): Promise<ManagedMemory[]> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        category,
        subject,
        content,
        source_message_id,
        source_line_user_id,
        source_line_timestamp,
        source_quote_token,
        updated_at
      FROM memories
      WHERE group_id = ${groupId}
        AND status = 'ACTIVE'
        AND (
          ${query}::text IS NULL
          OR category ILIKE '%' || ${query} || '%'
          OR COALESCE(subject, '') ILIKE '%' || ${query} || '%'
          OR content ILIKE '%' || ${query} || '%'
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limit}
    `);
    return (result.rows as MemoryRow[]).map(mapMemory);
  }

  async updateMemory(
    groupId: number,
    memoryId: number,
    actorLineUserId: string,
    input: MemoryUpdateInput,
    at: Date,
  ): Promise<'UPDATED' | 'NOT_FOUND'> {
    const result = await this.db.execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT id, category, subject, content
        FROM memories
        WHERE id = ${memoryId}
          AND group_id = ${groupId}
          AND status = 'ACTIVE'
        FOR UPDATE
      ),
      updated AS (
        UPDATE memories AS memory
        SET category = ${input.category},
            subject = ${input.subject},
            content = ${input.content},
            updated_at = ${at}
        FROM locked
        WHERE memory.id = locked.id
        RETURNING memory.id
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id,
          actor_line_user_id,
          action,
          target_type,
          target_id,
          before_value,
          after_value,
          created_at
        )
        SELECT
          ${groupId},
          ${actorLineUserId},
          'MEMORY_EDITED',
          'MEMORY',
          locked.id::text,
          jsonb_build_object(
            'category', locked.category,
            'subject', locked.subject,
            'content', locked.content
          ),
          jsonb_build_object(
            'category', ${input.category},
            'subject', ${input.subject},
            'content', ${input.content}
          ),
          ${at}
        FROM locked
        WHERE EXISTS (SELECT 1 FROM updated)
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated) AS changed
    `);
    const row = result.rows[0] as { changed: boolean } | undefined;
    return row?.changed ? 'UPDATED' : 'NOT_FOUND';
  }

  async deleteMemory(
    groupId: number,
    memoryId: number,
    actorLineUserId: string,
    at: Date,
  ): Promise<'DELETED' | 'NOT_FOUND'> {
    const result = await this.db.execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT id, category, subject, content
        FROM memories
        WHERE id = ${memoryId}
          AND group_id = ${groupId}
          AND status = 'ACTIVE'
        FOR UPDATE
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id,
          actor_line_user_id,
          action,
          target_type,
          target_id,
          before_value,
          after_value,
          created_at
        )
        SELECT
          ${groupId},
          ${actorLineUserId},
          'MEMORY_DELETED',
          'MEMORY',
          locked.id::text,
          jsonb_build_object(
            'category', locked.category,
            'subject', locked.subject,
            'content', locked.content
          ),
          jsonb_build_object('deleted', TRUE),
          ${at}
        FROM locked
        RETURNING target_id
      ),
      deleted AS (
        DELETE FROM memories AS memory
        USING locked
        WHERE memory.id = locked.id
          AND EXISTS (SELECT 1 FROM audit)
        RETURNING memory.id
      )
      SELECT EXISTS (SELECT 1 FROM deleted) AS changed
    `);
    const row = result.rows[0] as { changed: boolean } | undefined;
    return row?.changed ? 'DELETED' : 'NOT_FOUND';
  }

  async listReminders(groupId: number, limit: number): Promise<ManagedReminder[]> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, message, scheduled_for, status
      FROM reminders
      WHERE group_id = ${groupId}
      ORDER BY scheduled_for DESC, id DESC
      LIMIT ${limit}
    `);
    return (result.rows as ReminderRow[]).map((row) => ({
      id: Number(row.id),
      message: row.message,
      scheduledFor: new Date(row.scheduled_for).toISOString(),
      status: row.status,
    }));
  }
}
