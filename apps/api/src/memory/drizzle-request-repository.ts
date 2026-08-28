import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { MemoryRequestRepository, MemoryRequestResult } from './requests';
import type {
  AutomaticMemoryRequest,
  AutomaticMemoryRequestRepository,
} from './work';

type RequestRow = {
  id: string;
  status: MemoryRequestResult['status'];
  source_line_message_id: string;
};

type AutomaticRequestRow = {
  id: string;
  group_id: string;
  extraction_batch_id: string;
  status: AutomaticMemoryRequest['status'];
  created: boolean;
};

export class DrizzleMemoryRequestRepository
  implements MemoryRequestRepository, AutomaticMemoryRequestRepository
{
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

  async createAutomatic(
    input: Parameters<AutomaticMemoryRequestRepository['createAutomatic']>[0],
  ): Promise<AutomaticMemoryRequest> {
    const result = await this.db.execute(sql`
      WITH extraction_batch AS MATERIALIZED (
        SELECT id, group_id
        FROM conversation_extraction_batches
        WHERE id = ${input.extractionBatchId}
          AND group_id = ${input.groupId}
        FOR UPDATE
      ),
      existing_key AS (
        SELECT key.request_id
        FROM automatic_memory_request_keys key
        JOIN extraction_batch batch ON batch.id = key.extraction_batch_id
        WHERE key.group_id = ${input.groupId}
      ),
      inserted_request AS (
        INSERT INTO memory_candidate_requests (
          group_id,
          origin,
          status,
          extraction_batch_id,
          created_at,
          updated_at
        )
        SELECT
          batch.group_id,
          'AUTOMATIC',
          'PENDING',
          batch.id,
          ${input.createdAt},
          ${input.createdAt}
        FROM extraction_batch batch
        WHERE NOT EXISTS (SELECT 1 FROM existing_key)
        RETURNING id, group_id, extraction_batch_id, status
      ),
      inserted_key AS (
        INSERT INTO automatic_memory_request_keys (
          extraction_batch_id,
          request_id,
          group_id,
          created_at
        )
        SELECT
          request.extraction_batch_id,
          request.id,
          request.group_id,
          ${input.createdAt}
        FROM inserted_request request
        RETURNING request_id
      ),
      selected_request AS (
        SELECT request.id, request.group_id, request.extraction_batch_id, request.status, FALSE AS created
        FROM memory_candidate_requests request
        JOIN existing_key existing ON existing.request_id = request.id
        UNION ALL
        SELECT request.id, request.group_id, request.extraction_batch_id, request.status, TRUE AS created
        FROM inserted_request request
        JOIN inserted_key key ON key.request_id = request.id
      )
      SELECT
        id::text AS id,
        group_id::text AS group_id,
        extraction_batch_id::text AS extraction_batch_id,
        status,
        created
      FROM selected_request
      LIMIT 1
    `);

    const row = result.rows[0] as AutomaticRequestRow | undefined;
    if (!row) {
      throw new Error('automatic memory request could not be persisted for the extraction batch');
    }
    return {
      id: Number(row.id),
      groupId: Number(row.group_id),
      extractionBatchId: Number(row.extraction_batch_id),
      status: row.status,
      created: row.created,
    };
  }
}
