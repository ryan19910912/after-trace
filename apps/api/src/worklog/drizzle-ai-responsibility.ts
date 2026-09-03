import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAiResponsibilityRepository,
  WorklogGroupAiContext,
} from './ai-responsibility';

type ContextRow = {
  source_id: string | number;
  source_status: 'ACTIVE' | 'INACTIVE';
  actor_is_active: boolean;
  responsible_user_id: string | number | null;
  responsible_is_active: boolean;
};

export class DrizzleWorklogAiResponsibilityRepository implements WorklogAiResponsibilityRepository {
  constructor(private readonly db: Database) {}

  async getGroupAiContext(sourceId: number, actorUserId: number): Promise<WorklogGroupAiContext | null> {
    const result = await this.db.execute(sql`
      SELECT
        source.id::text AS source_id,
        source.status AS source_status,
        COALESCE(actor_member.is_active, FALSE) AS actor_is_active,
        responsibility.responsible_user_id::text AS responsible_user_id,
        COALESCE(responsible_member.is_active, FALSE) AS responsible_is_active
      FROM worklog_sources source
      LEFT JOIN worklog_source_members actor_member
        ON actor_member.source_id = source.id
       AND actor_member.user_id = ${actorUserId}
      LEFT JOIN worklog_source_ai_responsibility responsibility
        ON responsibility.source_id = source.id
      LEFT JOIN worklog_source_members responsible_member
        ON responsible_member.source_id = source.id
       AND responsible_member.user_id = responsibility.responsible_user_id
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
      LIMIT 1
    `);
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    return {
      sourceId: positiveInteger(row.source_id, 'source id'),
      sourceStatus: row.source_status,
      actorIsActiveMember: Boolean(row.actor_is_active),
      responsibleUserId: row.responsible_user_id == null
        ? null
        : positiveInteger(row.responsible_user_id, 'responsible user id'),
      responsibleUserIsActiveMember: Boolean(row.responsible_is_active),
    };
  }

  async assignIfUnbound(input: {
    sourceId: number;
    responsibleUserId: number;
    actorUserId: number;
    reason: string;
    at: Date;
  }): Promise<'ASSIGNED' | 'ALREADY_ASSIGNED' | 'CONFLICT' | 'SOURCE_NOT_FOUND' | 'ACTOR_NOT_ACTIVE'> {
    const source = await this.db.execute(sql`
      SELECT
        source.id::text AS id,
        COALESCE(member.is_active, FALSE) AS actor_is_active
      FROM worklog_sources source
      LEFT JOIN worklog_source_members member
        ON member.source_id = source.id
       AND member.user_id = ${input.actorUserId}
      WHERE source.id = ${input.sourceId}
        AND source.type = 'GROUP'
        AND source.status = 'ACTIVE'
      LIMIT 1
    `);
    const sourceRow = source.rows[0] as { id?: string; actor_is_active?: boolean } | undefined;
    if (!sourceRow?.id) return 'SOURCE_NOT_FOUND';
    if (!sourceRow.actor_is_active) return 'ACTOR_NOT_ACTIVE';

    const inserted = await this.db.execute(sql`
      WITH created AS (
        INSERT INTO worklog_source_ai_responsibility (
          source_id,
          responsible_user_id,
          assigned_by_user_id,
          assigned_at,
          updated_at
        ) VALUES (
          ${input.sourceId},
          ${input.responsibleUserId},
          ${input.actorUserId},
          ${input.at},
          ${input.at}
        )
        ON CONFLICT (source_id) DO NOTHING
        RETURNING source_id, responsible_user_id
      ), history AS (
        INSERT INTO worklog_source_ai_responsibility_history (
          source_id,
          previous_user_id,
          next_user_id,
          actor_user_id,
          reason,
          created_at
        )
        SELECT
          created.source_id,
          NULL,
          created.responsible_user_id,
          ${input.actorUserId},
          ${input.reason},
          ${input.at}
        FROM created
        RETURNING id
      )
      SELECT source_id::text AS source_id, responsible_user_id::text AS responsible_user_id
      FROM created
    `);
    if (inserted.rows.length > 0) return 'ASSIGNED';

    const current = await this.db.execute(sql`
      SELECT responsible_user_id::text AS responsible_user_id
      FROM worklog_source_ai_responsibility
      WHERE source_id = ${input.sourceId}
      LIMIT 1
    `);
    const currentUserId = (current.rows[0] as { responsible_user_id?: string } | undefined)?.responsible_user_id;
    if (!currentUserId) return 'SOURCE_NOT_FOUND';
    return positiveInteger(currentUserId, 'responsible user id') === input.responsibleUserId
      ? 'ALREADY_ASSIGNED'
      : 'CONFLICT';
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}
