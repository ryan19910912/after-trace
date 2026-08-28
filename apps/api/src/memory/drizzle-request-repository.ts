import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { MemoryRequestRepository, MemoryRequestResult } from './requests';

type RequestRow = {
  id: string;
  status: MemoryRequestResult['status'];
  source_line_message_id: string;
};

export class DrizzleMemoryRequestRepository implements MemoryRequestRepository {
  constructor(private readonly db: Database) {}

  async createExplicit(
    input: Parameters<MemoryRequestRepository['createExplicit']>[0],
  ): Promise<MemoryRequestResult> {
    const result = await this.db.execute(sql`
      WITH command_message AS (
        SELECT id
        FROM conversation_messages
        WHERE group_id = ${input.groupId}
          AND line_message_id = ${input.requestLineMessageId}
        LIMIT 1
      ),
      source_message AS (
        SELECT id
        FROM conversation_messages
        WHERE group_id = ${input.groupId}
          AND line_message_id = ${input.sourceLineMessageId}
        LIMIT 1
      )
      INSERT INTO memory_candidate_requests (
        group_id,
        origin,
        status,
        request_line_message_id,
        actor_line_user_id,
        source_line_message_id,
        source_conversation_message_id,
        instruction,
        created_at,
        updated_at
      )
      SELECT
        ${input.groupId},
        'EXPLICIT',
        CASE
          WHEN ${input.instruction} IS NULL
            AND NOT EXISTS (SELECT 1 FROM source_message)
            THEN 'BLOCKED_SOURCE_MISSING'
          ELSE 'PENDING'
        END,
        ${input.requestLineMessageId},
        ${input.actorLineUserId},
        ${input.sourceLineMessageId},
        (SELECT id FROM source_message),
        ${input.instruction},
        ${input.createdAt},
        ${input.createdAt}
      FROM command_message
      ON CONFLICT (group_id, request_line_message_id) DO UPDATE
      SET updated_at = memory_candidate_requests.updated_at
      RETURNING id::text AS id, status, source_line_message_id
    `);

    const row = result.rows[0] as RequestRow | undefined;
    if (!row) {
      throw new Error('explicit memory command message was not found in the conversation buffer');
    }
    return {
      id: Number(row.id),
      status: row.status,
      sourceLineMessageId: row.source_line_message_id,
    };
  }
}
