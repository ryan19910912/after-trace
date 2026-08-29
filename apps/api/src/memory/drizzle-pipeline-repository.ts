import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ActiveMemory,
  MemoryCandidateRepository,
  PersistedMemoryCandidate,
} from './pipeline';

type ActiveMemoryRow = {
  id: string;
  category: string;
  subject: string | null;
  content: string;
  source_message_id: string | null;
  source_line_user_id: string | null;
  source_line_timestamp: Date | null;
};

type PersistRow = {
  result_id: string;
  request_id: string;
  candidate_index: number;
  decision: PersistedMemoryCandidate['decision'];
  memory_id: string;
  target_memory_id: string | null;
  idempotent: boolean;
};

export class DrizzleMemoryCandidateRepository implements MemoryCandidateRepository {
  constructor(private readonly db: Database) {}

  async listActiveMemories(groupId: number): Promise<ActiveMemory[]> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        category,
        subject,
        content,
        source_message_id,
        source_line_user_id,
        source_line_timestamp
      FROM memories
      WHERE group_id = ${groupId}
        AND status = 'ACTIVE'
      ORDER BY updated_at DESC, id DESC
    `);

    return (result.rows as ActiveMemoryRow[]).map((row) => ({
      id: Number(row.id),
      category: row.category,
      subject: row.subject,
      content: row.content,
      sourceMessageId: row.source_message_id,
      sourceLineUserId: row.source_line_user_id,
      sourceLineTimestamp:
        row.source_line_timestamp === null ? null : new Date(row.source_line_timestamp),
    }));
  }

  async persistClassifiedCandidate(
    input: Parameters<MemoryCandidateRepository['persistClassifiedCandidate']>[0],
  ): Promise<PersistedMemoryCandidate> {
    const candidate = input.candidate;
    const result = await this.db.execute(sql`
      WITH request_owner AS MATERIALIZED (
        SELECT request.id, request.group_id, request.origin
        FROM memory_candidate_requests request
        JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.id = ${input.requestId}
          AND request.group_id = ${input.groupId}
          AND request.status = 'CLAIMED'
          AND work.attempt_count = ${input.claimAttemptCount}
        FOR UPDATE OF request, work
      ),
      existing_result AS (
        SELECT
          id,
          request_id,
          candidate_index,
          decision,
          persisted_memory_id,
          target_memory_id,
          source_conversation_message_id,
          category,
          subject,
          content
        FROM memory_candidate_results
        WHERE request_id = ${input.requestId}
          AND candidate_index = ${candidate.candidateIndex}
      ),
      matching_existing AS (
        SELECT *
        FROM existing_result
        WHERE decision = ${candidate.decision}
          AND target_memory_id IS NOT DISTINCT FROM ${candidate.targetMemoryId}
          AND source_conversation_message_id = ${candidate.sourceConversationMessageId}
          AND category = ${candidate.category}
          AND subject IS NOT DISTINCT FROM ${candidate.subject}
          AND content = ${candidate.content}
      ),
      source_message AS (
        SELECT message.*
        FROM conversation_messages message
        JOIN request_owner request ON request.group_id = message.group_id
        WHERE message.id = ${candidate.sourceConversationMessageId}
        LIMIT 1
      ),
      source_is_allowed AS (
        SELECT 1
        FROM request_owner request
        CROSS JOIN source_message source
        WHERE request.origin = 'EXPLICIT'
           OR EXISTS (
             SELECT 1
             FROM automatic_memory_eligible_subjects eligible
             WHERE eligible.request_id = request.id
               AND eligible.group_id = request.group_id
               AND eligible.line_user_id = source.line_user_id
           )
      ),
      target_memory AS MATERIALIZED (
        SELECT memory.*
        FROM memories memory
        JOIN request_owner request ON request.group_id = memory.group_id
        WHERE memory.id = ${candidate.targetMemoryId}
          AND memory.status = 'ACTIVE'
        FOR UPDATE
      ),
      validated AS (
        SELECT request.id AS request_id, request.group_id
        FROM request_owner request
        WHERE NOT EXISTS (SELECT 1 FROM existing_result)
          AND EXISTS (SELECT 1 FROM source_message)
          AND EXISTS (SELECT 1 FROM source_is_allowed)
          AND (
            (${candidate.decision} = 'NEW' AND ${candidate.targetMemoryId} IS NULL)
            OR (
              ${candidate.decision} IN ('DUPLICATE', 'UPDATE', 'CONTRADICT')
              AND EXISTS (SELECT 1 FROM target_memory)
            )
          )
      ),
      inserted_memory AS (
        INSERT INTO memories (
          group_id,
          category,
          subject,
          content,
          status,
          source_message_id,
          source_quote_token,
          source_line_user_id,
          source_line_timestamp,
          metadata,
          created_at,
          updated_at
        )
        SELECT
          validated.group_id,
          ${candidate.category},
          ${candidate.subject},
          ${candidate.content},
          'ACTIVE',
          source.line_message_id,
          source.quote_token,
          source.line_user_id,
          source.line_timestamp,
          source.metadata,
          ${input.createdAt},
          ${input.createdAt}
        FROM validated
        CROSS JOIN source_message source
        WHERE ${candidate.decision} IN ('NEW', 'UPDATE', 'CONTRADICT')
        RETURNING id, group_id, category, subject, content
      ),
      superseded_memory AS (
        UPDATE memories memory
        SET status = 'SUPERSEDED',
            superseded_by_id = (SELECT id FROM inserted_memory LIMIT 1),
            updated_at = ${input.createdAt}
        WHERE memory.id = (SELECT id FROM target_memory LIMIT 1)
          AND ${candidate.decision} IN ('UPDATE', 'CONTRADICT')
          AND EXISTS (SELECT 1 FROM inserted_memory)
        RETURNING memory.id
      ),
      inserted_result AS (
        INSERT INTO memory_candidate_results (
          request_id,
          candidate_index,
          decision,
          target_memory_id,
          persisted_memory_id,
          source_conversation_message_id,
          category,
          subject,
          content,
          created_at
        )
        SELECT
          validated.request_id,
          ${candidate.candidateIndex},
          ${candidate.decision},
          CASE WHEN ${candidate.decision} = 'NEW' THEN NULL ELSE target.id END,
          CASE WHEN ${candidate.decision} = 'DUPLICATE' THEN target.id ELSE inserted.id END,
          source.id,
          ${candidate.category},
          ${candidate.subject},
          ${candidate.content},
          ${input.createdAt}
        FROM validated
        CROSS JOIN source_message source
        LEFT JOIN target_memory target ON TRUE
        LEFT JOIN inserted_memory inserted ON TRUE
        RETURNING id, request_id, candidate_index, decision, persisted_memory_id, target_memory_id
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
          ${input.groupId},
          ${input.actorLineUserId},
          CASE result.decision
            WHEN 'NEW' THEN 'MEMORY_CREATED'
            WHEN 'DUPLICATE' THEN 'MEMORY_DUPLICATE_SKIPPED'
            WHEN 'UPDATE' THEN 'MEMORY_UPDATED'
            WHEN 'CONTRADICT' THEN 'MEMORY_CONTRADICTED'
          END,
          'MEMORY',
          result.persisted_memory_id::text,
          CASE
            WHEN result.target_memory_id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'memoryId', target.id,
              'category', target.category,
              'subject', target.subject,
              'content', target.content
            )
          END,
          CASE
            WHEN result.decision = 'DUPLICATE' THEN jsonb_build_object(
              'duplicateOfMemoryId', result.persisted_memory_id,
              'requestId', result.request_id,
              'candidateIndex', result.candidate_index
            )
            ELSE jsonb_build_object(
              'memoryId', inserted.id,
              'category', inserted.category,
              'subject', inserted.subject,
              'content', inserted.content,
              'requestId', result.request_id,
              'candidateIndex', result.candidate_index
            )
          END,
          ${input.createdAt}
        FROM inserted_result result
        LEFT JOIN target_memory target ON target.id = result.target_memory_id
        LEFT JOIN inserted_memory inserted ON inserted.id = result.persisted_memory_id
        RETURNING id
      )
      SELECT
        inserted.id::text AS result_id,
        inserted.request_id::text AS request_id,
        inserted.candidate_index,
        inserted.decision,
        inserted.persisted_memory_id::text AS memory_id,
        inserted.target_memory_id::text AS target_memory_id,
        FALSE AS idempotent
      FROM inserted_result inserted
      UNION ALL
      SELECT
        existing.id::text AS result_id,
        existing.request_id::text AS request_id,
        existing.candidate_index,
        existing.decision,
        existing.persisted_memory_id::text AS memory_id,
        existing.target_memory_id::text AS target_memory_id,
        TRUE AS idempotent
      FROM matching_existing existing
      LIMIT 1
    `);

    const row = result.rows[0] as PersistRow | undefined;
    if (!row) {
      throw new Error(
        'memory candidate persistence rejected: stale claim, conflicting retry, missing/ineligible source, or invalid active target',
      );
    }

    return {
      resultId: Number(row.result_id),
      requestId: Number(row.request_id),
      candidateIndex: row.candidate_index,
      decision: row.decision,
      memoryId: Number(row.memory_id),
      targetMemoryId: row.target_memory_id === null ? null : Number(row.target_memory_id),
      idempotent: row.idempotent,
    };
  }
}
