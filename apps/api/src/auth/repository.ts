import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

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
}
