import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { CachedLineText, WorklogLineTextCacheRepository } from './line-text-cache';

export class DrizzleWorklogLineTextCacheRepository implements WorklogLineTextCacheRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: CachedLineText): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_line_text_cache (
        line_message_id, line_group_id, line_user_id, text, line_timestamp, expires_at, created_at
      ) VALUES (
        ${input.lineMessageId}, ${input.lineGroupId}, ${input.lineUserId}, ${input.text},
        ${input.lineTimestamp}, ${input.expiresAt}, NOW()
      )
      ON CONFLICT (line_message_id) DO UPDATE SET
        line_group_id = EXCLUDED.line_group_id,
        line_user_id = EXCLUDED.line_user_id,
        text = EXCLUDED.text,
        line_timestamp = EXCLUDED.line_timestamp,
        expires_at = EXCLUDED.expires_at
      WHERE worklog_line_text_cache.line_group_id = EXCLUDED.line_group_id
    `);
  }

  async pruneGroup(lineGroupId: string, keepNewest: number, now: Date): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM worklog_line_text_cache
      WHERE expires_at <= ${now}
         OR line_message_id IN (
           SELECT line_message_id
           FROM worklog_line_text_cache
           WHERE line_group_id = ${lineGroupId}
           ORDER BY line_timestamp DESC, created_at DESC, line_message_id DESC
           OFFSET ${keepNewest}
         )
    `);
  }

  async findActive(lineGroupId: string, lineMessageId: string, now: Date): Promise<CachedLineText | null> {
    const result = await this.db.execute(sql`
      SELECT line_message_id, line_group_id, line_user_id, text, line_timestamp, expires_at
      FROM worklog_line_text_cache
      WHERE line_group_id = ${lineGroupId}
        AND line_message_id = ${lineMessageId}
        AND expires_at > ${now}
      LIMIT 1
    `);
    const row = result.rows[0] as {
      line_message_id: string;
      line_group_id: string;
      line_user_id: string | null;
      text: string;
      line_timestamp: Date | string;
      expires_at: Date | string;
    } | undefined;
    return row ? {
      lineMessageId: row.line_message_id,
      lineGroupId: row.line_group_id,
      lineUserId: row.line_user_id,
      text: row.text,
      lineTimestamp: new Date(row.line_timestamp),
      expiresAt: new Date(row.expires_at),
    } : null;
  }
}
