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
