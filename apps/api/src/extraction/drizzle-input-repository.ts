import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ExtractionBatchInput,
  ExtractionInputMessage,
  ExtractionInputRepository,
} from './input';

type InputRow = {
  batch_id: string;
  group_id: string;
  previous_batch_id: string | null;
  context_kind: 'CURRENT' | 'PREVIOUS';
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

function mapMessage(row: InputRow): ExtractionInputMessage {
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

export class DrizzleExtractionInputRepository implements ExtractionInputRepository {
  constructor(private readonly db: Database) {}

  async loadBatchInput(batchId: number): Promise<ExtractionBatchInput | null> {
    const result = await this.db.execute(sql`
      WITH current_batch AS (
        SELECT id, group_id
        FROM conversation_extraction_batches
        WHERE id = ${batchId}
        LIMIT 1
      ),
      previous_batch AS (
        SELECT batch.id
        FROM conversation_extraction_batches AS batch
        INNER JOIN current_batch ON current_batch.group_id = batch.group_id
        WHERE batch.status = 'SUCCEEDED'
          AND batch.id < current_batch.id
        ORDER BY batch.completed_at DESC NULLS LAST, batch.id DESC
        LIMIT 1
      )
      SELECT
        current_batch.id::text AS batch_id,
        current_batch.group_id::text AS group_id,
        previous_batch.id::text AS previous_batch_id,
        CASE
          WHEN message.extraction_batch_id = current_batch.id THEN 'CURRENT'
          ELSE 'PREVIOUS'
        END AS context_kind,
        message.id::text AS id,
        message.line_message_id,
        message.line_user_id,
        message.message_type,
        message.text_content,
        message.char_count,
        message.quote_token,
        message.quoted_line_message_id,
        message.line_timestamp,
        message.metadata
      FROM current_batch
      LEFT JOIN previous_batch ON TRUE
      INNER JOIN conversation_messages AS message
        ON message.extraction_batch_id = current_batch.id
        OR message.extraction_batch_id = previous_batch.id
      ORDER BY
        CASE WHEN message.extraction_batch_id = current_batch.id THEN 1 ELSE 0 END,
        message.id
    `);

    const rows = result.rows as InputRow[];
    if (rows.length === 0) {
      const batch = await this.db.execute(sql`
        SELECT id::text AS id, group_id::text AS group_id
        FROM conversation_extraction_batches
        WHERE id = ${batchId}
        LIMIT 1
      `);
      const row = batch.rows[0] as { id: string; group_id: string } | undefined;
      if (!row) return null;
      return {
        batchId: Number(row.id),
        groupId: Number(row.group_id),
        currentMessages: [],
        previousContext: null,
      };
    }

    const currentMessages: ExtractionInputMessage[] = [];
    const previousMessages: ExtractionInputMessage[] = [];
    for (const row of rows) {
      if (row.context_kind === 'CURRENT') currentMessages.push(mapMessage(row));
      else previousMessages.push(mapMessage(row));
    }

    const first = rows[0];
    return {
      batchId: Number(first.batch_id),
      groupId: Number(first.group_id),
      currentMessages,
      previousContext:
        first.previous_batch_id && previousMessages.length > 0
          ? { batchId: Number(first.previous_batch_id), messages: previousMessages }
          : null,
    };
  }
}
