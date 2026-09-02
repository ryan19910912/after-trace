import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type WebGroupMemory = {
  id: number;
  groupId: number;
  lineGroupId: string;
  category: string;
  subject: string | null;
  content: string;
  sourceMessageId: string | null;
  sourceLineTimestamp: string | null;
  updatedAt: string;
};

export type ConsumePrivateEntryResult = 'CONSUMED' | 'ALREADY_USED' | 'ACCESS_REVOKED' | 'INVALID_OR_EXPIRED';

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export class DrizzleWebAuthRepository {
  constructor(private readonly db: Database) {}

  async registerEntry(input: {
    nonce: string;
    lineUserId: string;
    lineGroupId: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      WITH pruned AS (
        DELETE FROM web_auth_entry_nonces
        WHERE expires_at <= now()
        RETURNING nonce
      )
      INSERT INTO web_auth_entry_nonces (nonce, line_user_id, line_group_id, expires_at)
      VALUES (${input.nonce}, ${input.lineUserId}, ${input.lineGroupId}, ${input.expiresAt})
      ON CONFLICT (nonce) DO NOTHING
      RETURNING nonce
    `);
    return result.rows.length === 1;
  }

  async consumeEntry(input: {
    nonce: string;
    lineUserId: string;
    lineGroupId: string;
    at: Date;
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE web_auth_entry_nonces
      SET consumed_at = ${input.at}
      WHERE nonce = ${input.nonce}
        AND line_user_id = ${input.lineUserId}
        AND line_group_id = ${input.lineGroupId}
        AND consumed_at IS NULL
        AND expires_at > ${input.at}
      RETURNING nonce
    `);
    return result.rows.length === 1;
  }

  async registerPrivateEntry(input: {
    nonce: string;
    lineUserId: string;
    userId: number;
    sourceId: number;
    expiresAt: Date;
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      WITH pruned AS (
        DELETE FROM worklog_private_web_entry_nonces
        WHERE expires_at <= now()
        RETURNING nonce
      )
      INSERT INTO worklog_private_web_entry_nonces (
        nonce,
        line_user_id,
        user_id,
        source_id,
        expires_at
      )
      SELECT
        ${input.nonce},
        ${input.lineUserId},
        ${input.userId},
        ${input.sourceId},
        ${input.expiresAt}
      FROM worklog_users u
      JOIN worklog_sources s
        ON s.id = ${input.sourceId}
       AND s.type = 'PRIVATE'
       AND s.status = 'ACTIVE'
       AND s.private_user_id = u.id
      WHERE u.id = ${input.userId}
        AND u.line_user_id = ${input.lineUserId}
        AND u.is_oa_friend = TRUE
      ON CONFLICT (nonce) DO NOTHING
      RETURNING nonce
    `);
    return result.rows.length === 1;
  }

  async consumePrivateEntry(input: {
    nonce: string;
    lineUserId: string;
    userId: number;
    sourceId: number;
    at: Date;
  }): Promise<ConsumePrivateEntryResult> {
    const consumed = await this.db.execute(sql`
      UPDATE worklog_private_web_entry_nonces e
      SET consumed_at = ${input.at}
      FROM worklog_users u, worklog_sources s
      WHERE e.nonce = ${input.nonce}
        AND e.line_user_id = ${input.lineUserId}
        AND e.user_id = ${input.userId}
        AND e.source_id = ${input.sourceId}
        AND e.consumed_at IS NULL
        AND e.expires_at > ${input.at}
        AND u.id = e.user_id
        AND u.line_user_id = e.line_user_id
        AND u.is_oa_friend = TRUE
        AND s.id = e.source_id
        AND s.type = 'PRIVATE'
        AND s.status = 'ACTIVE'
        AND s.private_user_id = u.id
      RETURNING e.nonce
    `);
    if (consumed.rows.length === 1) return 'CONSUMED';

    const state = await this.db.execute(sql`
      SELECT
        e.consumed_at,
        e.expires_at,
        u.is_oa_friend,
        s.id::text AS source_id,
        s.type::text AS source_type,
        s.status::text AS source_status,
        s.private_user_id::text AS private_user_id
      FROM worklog_private_web_entry_nonces e
      LEFT JOIN worklog_users u
        ON u.id = e.user_id
       AND u.line_user_id = e.line_user_id
      LEFT JOIN worklog_sources s
        ON s.id = e.source_id
      WHERE e.nonce = ${input.nonce}
        AND e.line_user_id = ${input.lineUserId}
        AND e.user_id = ${input.userId}
        AND e.source_id = ${input.sourceId}
      LIMIT 1
    `);
    const row = state.rows[0] as Record<string, unknown> | undefined;
    if (!row) return 'INVALID_OR_EXPIRED';
    if (row.consumed_at !== null && row.consumed_at !== undefined) return 'ALREADY_USED';
    const expiresAt = row.expires_at ? new Date(row.expires_at as Date | string) : null;
    if (!expiresAt || expiresAt <= input.at) return 'INVALID_OR_EXPIRED';
    if (
      row.is_oa_friend !== true ||
      Number(row.source_id) !== input.sourceId ||
      row.source_type !== 'PRIVATE' ||
      row.source_status !== 'ACTIVE' ||
      Number(row.private_user_id) !== input.userId
    ) {
      return 'ACCESS_REVOKED';
    }
    return 'INVALID_OR_EXPIRED';
  }

  async listActiveGroups(lineUserId: string): Promise<Array<{ id: number; lineGroupId: string }>> {
    const result = await this.db.execute(sql`
      SELECT g.id::text AS id, g.line_group_id
      FROM group_members gm
      JOIN line_groups g ON g.id = gm.group_id
      WHERE gm.line_user_id = ${lineUserId}
        AND gm.is_active = TRUE
        AND g.status = 'ACTIVE'
      ORDER BY gm.last_seen_at DESC, g.id DESC
    `);
    return result.rows.flatMap((row) => {
      if (typeof row.id !== 'string' || typeof row.line_group_id !== 'string') return [];
      const id = Number(row.id);
      return Number.isSafeInteger(id) && id > 0 ? [{ id, lineGroupId: row.line_group_id }] : [];
    });
  }

  async listGroupMemories(
    groupIds: readonly number[],
    query: string | null,
    limit = 200,
  ): Promise<WebGroupMemory[]> {
    if (groupIds.length === 0) return [];
    const ids = sql.join(groupIds.map((id) => sql`${id}`), sql`, `);
    const result = await this.db.execute(sql`
      SELECT
        m.id::text AS id,
        m.group_id::text AS group_id,
        g.line_group_id,
        m.category,
        m.subject,
        m.content,
        m.source_message_id,
        m.source_line_timestamp,
        m.updated_at
      FROM memories m
      JOIN line_groups g ON g.id = m.group_id
      WHERE m.group_id IN (${ids})
        AND m.status = 'ACTIVE'
        AND (
          ${query}::text IS NULL
          OR m.category ILIKE '%' || ${query} || '%'
          OR COALESCE(m.subject, '') ILIKE '%' || ${query} || '%'
          OR m.content ILIKE '%' || ${query} || '%'
        )
      ORDER BY m.updated_at DESC, m.id DESC
      LIMIT ${limit}
    `);
    return result.rows.flatMap((raw) => {
      const row = raw as Record<string, unknown>;
      const id = Number(row.id);
      const groupId = Number(row.group_id);
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(groupId) || typeof row.line_group_id !== 'string') return [];
      return [{
        id,
        groupId,
        lineGroupId: row.line_group_id,
        category: String(row.category ?? ''),
        subject: typeof row.subject === 'string' ? row.subject : null,
        content: String(row.content ?? ''),
        sourceMessageId: typeof row.source_message_id === 'string' ? row.source_message_id : null,
        sourceLineTimestamp: iso(row.source_line_timestamp as Date | string | null),
        updatedAt: new Date(row.updated_at as Date | string).toISOString(),
      }];
    });
  }
}
