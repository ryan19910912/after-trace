import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ExtractionInputMessage } from '../extraction/input';
import type { MemorySourceMessageRepository } from './classification-input';

type SourceRow = {
  id: string;
  line_message_id: string;
  line_user_id: string | null;
  message_type: string;
  text_content: string | null;
  char_count: number;
  quote_token: string | null;
  quoted_line_message_id: string | null;
  line_timestamp: Date | string;
  metadata: Record<string, unknown> | null;
};

export class DrizzleMemorySourceMessageRepository implements MemorySourceMessageRepository {
  constructor(private readonly db: Database) {}

  async loadById(
    groupId: number,
    conversationMessageId: number,
  ): Promise<ExtractionInputMessage | null> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        line_message_id,
        line_user_id,
        message_type,
        text_content,
        char_count,
        quote_token,
        quoted_line_message_id,
        line_timestamp,
        metadata
      FROM conversation_messages
      WHERE id = ${conversationMessageId}
        AND group_id = ${groupId}
      LIMIT 1
    `);
    const row = result.rows[0] as SourceRow | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      lineMessageId: row.line_message_id,
      lineUserId: row.line_user_id,
      messageType: row.message_type,
      textContent: row.text_content,
      charCount: Number(row.char_count),
      quoteToken: row.quote_token,
      quotedLineMessageId: row.quoted_line_message_id,
      lineTimestamp:
        row.line_timestamp instanceof Date ? row.line_timestamp : new Date(row.line_timestamp),
      metadata: row.metadata,
    };
  }
}
