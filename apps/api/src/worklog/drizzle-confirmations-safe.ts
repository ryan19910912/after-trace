import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogConfirmationCandidate,
  WorklogConfirmationRepository,
  WorklogConfirmationResolution,
  WorklogPendingConfirmation,
} from './confirmations';

type PendingOperation = WorklogPendingConfirmation['operation'];

type PendingState = {
  id: number;
  sourceId: number;
  recordId: number;
  requestedUserId: number;
  confirmationType: WorklogPendingConfirmation['confirmationType'];
  candidateEntityId: number | null;
  proposedName: string | null;
  reason: string | null;
  operation: PendingOperation;
  proposedRawText: string | null;
  occurredAt: Date;
  expectedRecordVersion: number;
  previousEntityId: number | null;
  lineEditId: number | null;
  candidates: WorklogConfirmationCandidate[];
  recordRawText: string;
  currentOccurredAt: Date;
  currentEntityId: number | null;
  recordEligible: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

/**
 * Safe durable resolver for already-paid AI ambiguity.
 *
 * CREATE_TITLE confirmations attach the first title to an unresolved AI-created Record.
 * LINE_AI_EDIT confirmations are different: the provider call and point settlement are
 * already durable, so resolving the title must atomically apply the complete proposed
 * edit (raw text / occurred_at / one Entity), append an immutable Revision and finish
 * worklog_line_ai_edits. No confirmation path calls AI or consumes more points.
 */
export class DrizzleWorklogConfirmationRepository implements WorklogConfirmationRepository {
  constructor(private readonly db: Database) {}

  async listPending(input: { requestedUserId: number; sourceId: number; at: Date }) {
    await this.expireInvalid(input.requestedUserId, input.sourceId, input.at);
    const result = await this.db.execute(sql`
      SELECT
        c.id::text AS id,
        c.source_id::text AS source_id,
        c.record_id::text AS record_id,
        c.requested_user_id::text AS requested_user_id,
        c.confirmation_type,
        c.candidate_entity_id::text AS candidate_entity_id,
        candidate.name AS candidate_title,
        c.proposed_name,
        c.payload,
        r.raw_text AS record_raw_text,
        r.occurred_at AS current_occurred_at,
        r.entity_id::text AS current_entity_id,
        c.expires_at,
        c.created_at
      FROM worklog_ai_confirmations c
      INNER JOIN worklog_records r ON r.id = c.record_id AND r.source_id = c.source_id
      LEFT JOIN worklog_entities candidate
        ON candidate.id = c.candidate_entity_id AND candidate.source_id = c.source_id
      WHERE c.requested_user_id = ${input.requestedUserId}
        AND c.source_id = ${input.sourceId}
        AND c.status = 'PENDING'
        AND (c.expires_at IS NULL OR c.expires_at > ${input.at})
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 50
    `);
    return result.rows.map((row) => pendingFromRow(row));
  }

  async resolveExisting(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    entityId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const state = await this.pendingState(input.confirmationId, input.requestedUserId, input.sourceId, input.at);
    if (!state) return this.terminalResult(input.confirmationId, input.requestedUserId, input.sourceId);
    if (!state.recordEligible) return { status: 'RECORD_CHANGED' };
    if (!candidateAllowed(state, input.entityId)) return { status: 'ENTITY_NOT_ALLOWED' };

    const entity = await this.entity(input.sourceId, input.entityId);
    if (!entity) return { status: 'ENTITY_NOT_ALLOWED' };
    const createAlias = state.confirmationType === 'ALIAS_MATCH' && Boolean(state.proposedName);
    if (createAlias && state.proposedName) {
      const conflict = await this.titleConflict(input.sourceId, state.proposedName, input.entityId);
      if (conflict) return { status: 'TITLE_CONFLICT' };
    }

    if (state.operation === 'LINE_AI_EDIT') {
      return this.applyLineEditDecision({
        state,
        targetEntityId: input.entityId,
        targetTitle: entity.name,
        createdEntity: false,
        createAlias,
        at: input.at,
      });
    }

    const result = await this.db.execute(sql`
      WITH updated_record AS (
        UPDATE worklog_records record
        SET entity_id = ${input.entityId},
            occurred_at = ${state.occurredAt},
            updated_at = ${input.at}
        WHERE record.id = ${state.recordId}
          AND record.source_id = ${state.sourceId}
          AND record.status = 'ACTIVE'
          AND record.entity_id IS NULL
          AND record.version = ${state.expectedRecordVersion}
        RETURNING record.id
      ), alias_insert AS (
        INSERT INTO worklog_entity_aliases (
          source_id, entity_id, alias, created_by_user_id, created_via, created_at, updated_at
        )
        SELECT
          ${state.sourceId}, ${input.entityId}, BTRIM(${state.proposedName}),
          ${input.requestedUserId}, 'AI_CONFIRMATION', ${input.at}, ${input.at}
        FROM updated_record
        WHERE ${createAlias}
          AND ${state.proposedName}::text IS NOT NULL
          AND BTRIM(${state.proposedName}) <> ''
          AND LOWER(BTRIM(${state.proposedName})) <> LOWER(BTRIM(${entity.name}))
        ON CONFLICT (source_id, alias) DO NOTHING
        RETURNING id
      ), resolved AS (
        UPDATE worklog_ai_confirmations confirmation
        SET status = 'CONFIRMED',
            resolved_at = ${input.at},
            resolved_by_user_id = ${input.requestedUserId},
            updated_at = ${input.at}
        FROM updated_record
        WHERE confirmation.id = ${state.id}
          AND confirmation.status = 'PENDING'
        RETURNING confirmation.id
      )
      SELECT updated_record.id::text AS record_id,
             EXISTS (SELECT 1 FROM alias_insert) AS alias_created
      FROM updated_record
      INNER JOIN resolved ON resolved.id = ${state.id}
      LIMIT 1
    `);
    const row = result.rows[0] as { record_id?: string; alias_created?: boolean } | undefined;
    if (!row?.record_id) return { status: 'RECORD_CHANGED' };
    return {
      status: 'CONFIRMED',
      confirmationId: state.id,
      recordId: positiveNumber(row.record_id, 'record id'),
      entityId: input.entityId,
      title: entity.name,
      createdEntity: false,
      aliasCreated: Boolean(row.alias_created),
    };
  }

  async resolveNewTitle(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    title: string;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const state = await this.pendingState(input.confirmationId, input.requestedUserId, input.sourceId, input.at);
    if (!state) return this.terminalResult(input.confirmationId, input.requestedUserId, input.sourceId);
    if (!state.recordEligible) return { status: 'RECORD_CHANGED' };

    const title = input.title.trim() || state.proposedName?.trim() || '';
    if (!title || title.length > 255) return { status: 'TITLE_REQUIRED' };
    if (await this.exactAliasExists(state.sourceId, title)) return { status: 'TITLE_CONFLICT' };

    let target = await this.entityByExactName(state.sourceId, title);
    let createdEntity = false;
    if (!target) {
      const inserted = await this.db.execute(sql`
        INSERT INTO worklog_entities (source_id, name, status, created_at, updated_at)
        VALUES (${state.sourceId}, ${title}, 'ACTIVE', ${input.at}, ${input.at})
        ON CONFLICT (source_id, name) DO NOTHING
        RETURNING id::text AS id, name
      `);
      const row = inserted.rows[0] as { id?: string; name?: string } | undefined;
      if (row?.id && row.name) {
        target = { id: positiveNumber(row.id, 'entity id'), name: row.name };
        createdEntity = true;
      } else {
        target = await this.entityByExactName(state.sourceId, title);
      }
    }
    if (!target) return { status: 'TITLE_CONFLICT' };

    if (state.operation === 'LINE_AI_EDIT') {
      const resolved = await this.applyLineEditDecision({
        state,
        targetEntityId: target.id,
        targetTitle: target.name,
        createdEntity,
        createAlias: false,
        at: input.at,
      });
      if (resolved.status !== 'CONFIRMED' && createdEntity) await this.deleteUnusedEntity(target.id);
      return resolved;
    }

    const result = await this.db.execute(sql`
      WITH updated_record AS (
        UPDATE worklog_records record
        SET entity_id = ${target.id},
            occurred_at = ${state.occurredAt},
            updated_at = ${input.at}
        WHERE record.id = ${state.recordId}
          AND record.source_id = ${state.sourceId}
          AND record.status = 'ACTIVE'
          AND record.entity_id IS NULL
          AND record.version = ${state.expectedRecordVersion}
        RETURNING record.id
      ), resolved AS (
        UPDATE worklog_ai_confirmations confirmation
        SET status = 'CONFIRMED',
            resolved_at = ${input.at},
            resolved_by_user_id = ${input.requestedUserId},
            updated_at = ${input.at}
        FROM updated_record
        WHERE confirmation.id = ${state.id}
          AND confirmation.status = 'PENDING'
        RETURNING confirmation.id
      )
      SELECT updated_record.id::text AS record_id
      FROM updated_record
      INNER JOIN resolved ON resolved.id = ${state.id}
      LIMIT 1
    `);
    const recordId = (result.rows[0] as { record_id?: string } | undefined)?.record_id;
    if (!recordId) {
      if (createdEntity) await this.deleteUnusedEntity(target.id);
      return { status: 'RECORD_CHANGED' };
    }
    return {
      status: 'CONFIRMED',
      confirmationId: state.id,
      recordId: positiveNumber(recordId, 'record id'),
      entityId: target.id,
      title: target.name,
      createdEntity,
      aliasCreated: false,
    };
  }

  async reject(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const result = await this.db.execute(sql`
      WITH rejected AS (
        UPDATE worklog_ai_confirmations confirmation
        SET status = 'REJECTED',
            resolved_at = ${input.at},
            resolved_by_user_id = ${input.requestedUserId},
            updated_at = ${input.at}
        WHERE confirmation.id = ${input.confirmationId}
          AND confirmation.requested_user_id = ${input.requestedUserId}
          AND confirmation.source_id = ${input.sourceId}
          AND confirmation.status = 'PENDING'
          AND (confirmation.expires_at IS NULL OR confirmation.expires_at > ${input.at})
          AND (
            COALESCE(confirmation.payload->>'operation', '') <> 'LINE_AI_EDIT'
            OR EXISTS (
              SELECT 1 FROM worklog_line_ai_edits edit
              WHERE edit.id = CASE
                WHEN (confirmation.payload->>'lineEditId') ~ '^[0-9]+$'
                THEN (confirmation.payload->>'lineEditId')::bigint
                ELSE -1
              END
                AND edit.confirmation_id = confirmation.id
                AND edit.status = 'PENDING_CONFIRMATION'
            )
          )
        RETURNING confirmation.id, confirmation.record_id, confirmation.payload
      ), failed_edit AS (
        UPDATE worklog_line_ai_edits edit
        SET status = 'FAILED',
            last_error_code = 'AI_EDIT_CONFIRMATION_REJECTED',
            last_error_detail = 'User rejected the already-paid LINE AI edit confirmation.',
            completed_at = COALESCE(edit.completed_at, ${input.at}),
            updated_at = ${input.at}
        FROM rejected
        WHERE rejected.payload->>'operation' = 'LINE_AI_EDIT'
          AND (rejected.payload->>'lineEditId') ~ '^[0-9]+$'
          AND edit.id = (rejected.payload->>'lineEditId')::bigint
          AND edit.confirmation_id = rejected.id
          AND edit.status = 'PENDING_CONFIRMATION'
        RETURNING edit.id
      )
      SELECT id::text AS id, record_id::text AS record_id FROM rejected LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; record_id?: string } | undefined;
    if (row?.id && row.record_id) {
      return {
        status: 'REJECTED',
        confirmationId: positiveNumber(row.id, 'confirmation id'),
        recordId: positiveNumber(row.record_id, 'record id'),
      };
    }
    return this.terminalResult(input.confirmationId, input.requestedUserId, input.sourceId);
  }

  private async applyLineEditDecision(input: {
    state: PendingState;
    targetEntityId: number;
    targetTitle: string;
    createdEntity: boolean;
    createAlias: boolean;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const { state } = input;
    if (!state.lineEditId || state.proposedRawText === null) return { status: 'RECORD_CHANGED' };
    const nextVersion = state.expectedRecordVersion + 1;
    const changed = state.proposedRawText !== state.recordRawText
      || state.occurredAt.getTime() !== state.currentOccurredAt.getTime()
      || input.targetEntityId !== state.currentEntityId;

    const result = changed
      ? await this.db.execute(sql`
          WITH eligible AS MATERIALIZED (
            SELECT record.id
            FROM worklog_records record
            INNER JOIN worklog_ai_confirmations confirmation
              ON confirmation.id = ${state.id}
             AND confirmation.record_id = record.id
             AND confirmation.source_id = record.source_id
             AND confirmation.status = 'PENDING'
            INNER JOIN worklog_line_ai_edits edit
              ON edit.id = ${state.lineEditId}
             AND edit.record_id = record.id
             AND edit.source_id = record.source_id
             AND edit.confirmation_id = confirmation.id
             AND edit.status = 'PENDING_CONFIRMATION'
            WHERE record.id = ${state.recordId}
              AND record.source_id = ${state.sourceId}
              AND record.status = 'ACTIVE'
              AND record.version = ${state.expectedRecordVersion}
              AND record.entity_id IS NOT DISTINCT FROM ${state.previousEntityId}
              AND EXISTS (
                SELECT 1 FROM worklog_entities entity
                WHERE entity.id = ${input.targetEntityId}
                  AND entity.source_id = record.source_id
                  AND entity.status = 'ACTIVE'
              )
            FOR UPDATE OF record, confirmation, edit
          ), updated_record AS (
            UPDATE worklog_records record
            SET raw_text = ${state.proposedRawText},
                occurred_at = ${state.occurredAt},
                entity_id = ${input.targetEntityId},
                version = ${nextVersion},
                updated_at = ${input.at}
            FROM eligible
            WHERE record.id = eligible.id
            RETURNING record.id, record.version
          ), revision AS (
            INSERT INTO worklog_record_revisions (
              record_id, version, editor_user_id, channel,
              previous_raw_text, new_raw_text,
              previous_occurred_at, new_occurred_at,
              previous_entity_id, new_entity_id,
              previous_status, new_status, created_at
            )
            SELECT
              ${state.recordId}, ${nextVersion}, ${state.requestedUserId}, 'LINE_AI_EDIT',
              ${state.recordRawText}, ${state.proposedRawText},
              ${state.currentOccurredAt}, ${state.occurredAt},
              ${state.currentEntityId}, ${input.targetEntityId},
              'ACTIVE', 'ACTIVE', ${input.at}
            FROM updated_record
            RETURNING id
          ), alias_insert AS (
            INSERT INTO worklog_entity_aliases (
              source_id, entity_id, alias, created_by_user_id, created_via, created_at, updated_at
            )
            SELECT
              ${state.sourceId}, ${input.targetEntityId}, BTRIM(${state.proposedName}),
              ${state.requestedUserId}, 'AI_CONFIRMATION', ${input.at}, ${input.at}
            FROM updated_record
            WHERE ${input.createAlias}
              AND ${state.proposedName}::text IS NOT NULL
              AND BTRIM(${state.proposedName}) <> ''
              AND LOWER(BTRIM(${state.proposedName})) <> LOWER(BTRIM(${input.targetTitle}))
            ON CONFLICT (source_id, alias) DO NOTHING
            RETURNING id
          ), resolved AS (
            UPDATE worklog_ai_confirmations confirmation
            SET status = 'CONFIRMED',
                resolved_at = ${input.at},
                resolved_by_user_id = ${state.requestedUserId},
                updated_at = ${input.at}
            FROM updated_record, revision
            WHERE confirmation.id = ${state.id}
              AND confirmation.status = 'PENDING'
            RETURNING confirmation.id
          ), finished AS (
            UPDATE worklog_line_ai_edits edit
            SET status = 'SUCCEEDED',
                applied_record_version = ${nextVersion},
                applied_entity_id = ${input.targetEntityId},
                completed_at = ${input.at},
                updated_at = ${input.at}
            FROM updated_record, resolved
            WHERE edit.id = ${state.lineEditId}
              AND edit.confirmation_id = resolved.id
              AND edit.status = 'PENDING_CONFIRMATION'
            RETURNING edit.applied_record_version
          )
          SELECT updated_record.id::text AS record_id,
                 EXISTS (SELECT 1 FROM alias_insert) AS alias_created
          FROM updated_record
          INNER JOIN resolved ON resolved.id = ${state.id}
          INNER JOIN finished ON finished.applied_record_version = ${nextVersion}
          LIMIT 1
        `)
      : await this.db.execute(sql`
          WITH eligible AS MATERIALIZED (
            SELECT record.id
            FROM worklog_records record
            INNER JOIN worklog_ai_confirmations confirmation
              ON confirmation.id = ${state.id}
             AND confirmation.record_id = record.id
             AND confirmation.source_id = record.source_id
             AND confirmation.status = 'PENDING'
            INNER JOIN worklog_line_ai_edits edit
              ON edit.id = ${state.lineEditId}
             AND edit.record_id = record.id
             AND edit.source_id = record.source_id
             AND edit.confirmation_id = confirmation.id
             AND edit.status = 'PENDING_CONFIRMATION'
            WHERE record.id = ${state.recordId}
              AND record.source_id = ${state.sourceId}
              AND record.status = 'ACTIVE'
              AND record.version = ${state.expectedRecordVersion}
              AND record.entity_id IS NOT DISTINCT FROM ${state.previousEntityId}
              AND EXISTS (
                SELECT 1 FROM worklog_entities entity
                WHERE entity.id = ${input.targetEntityId}
                  AND entity.source_id = record.source_id
                  AND entity.status = 'ACTIVE'
              )
            FOR UPDATE OF record, confirmation, edit
          ), alias_insert AS (
            INSERT INTO worklog_entity_aliases (
              source_id, entity_id, alias, created_by_user_id, created_via, created_at, updated_at
            )
            SELECT
              ${state.sourceId}, ${input.targetEntityId}, BTRIM(${state.proposedName}),
              ${state.requestedUserId}, 'AI_CONFIRMATION', ${input.at}, ${input.at}
            FROM eligible
            WHERE ${input.createAlias}
              AND ${state.proposedName}::text IS NOT NULL
              AND BTRIM(${state.proposedName}) <> ''
              AND LOWER(BTRIM(${state.proposedName})) <> LOWER(BTRIM(${input.targetTitle}))
            ON CONFLICT (source_id, alias) DO NOTHING
            RETURNING id
          ), resolved AS (
            UPDATE worklog_ai_confirmations confirmation
            SET status = 'CONFIRMED',
                resolved_at = ${input.at},
                resolved_by_user_id = ${state.requestedUserId},
                updated_at = ${input.at}
            FROM eligible
            WHERE confirmation.id = ${state.id}
              AND confirmation.status = 'PENDING'
            RETURNING confirmation.id
          ), finished AS (
            UPDATE worklog_line_ai_edits edit
            SET status = 'SUCCEEDED',
                applied_record_version = ${state.expectedRecordVersion},
                applied_entity_id = ${input.targetEntityId},
                completed_at = ${input.at},
                updated_at = ${input.at}
            FROM eligible, resolved
            WHERE edit.id = ${state.lineEditId}
              AND edit.confirmation_id = resolved.id
              AND edit.status = 'PENDING_CONFIRMATION'
            RETURNING edit.applied_record_version
          )
          SELECT eligible.id::text AS record_id,
                 EXISTS (SELECT 1 FROM alias_insert) AS alias_created
          FROM eligible
          INNER JOIN resolved ON resolved.id = ${state.id}
          INNER JOIN finished ON finished.applied_record_version = ${state.expectedRecordVersion}
          LIMIT 1
        `);

    const row = result.rows[0] as { record_id?: string; alias_created?: boolean } | undefined;
    if (!row?.record_id) return { status: 'RECORD_CHANGED' };
    return {
      status: 'CONFIRMED',
      confirmationId: state.id,
      recordId: positiveNumber(row.record_id, 'record id'),
      entityId: input.targetEntityId,
      title: input.targetTitle,
      createdEntity: input.createdEntity,
      aliasCreated: Boolean(row.alias_created),
    };
  }

  private async pendingState(
    confirmationId: number,
    requestedUserId: number,
    sourceId: number,
    at: Date,
  ): Promise<PendingState | null> {
    const result = await this.db.execute(sql`
      SELECT
        c.id::text AS id,
        c.source_id::text AS source_id,
        c.record_id::text AS record_id,
        c.requested_user_id::text AS requested_user_id,
        c.confirmation_type,
        c.candidate_entity_id::text AS candidate_entity_id,
        c.proposed_name,
        c.payload,
        r.raw_text AS record_raw_text,
        r.occurred_at AS current_occurred_at,
        r.entity_id::text AS current_entity_id,
        c.expires_at,
        c.created_at,
        (
          r.status = 'ACTIVE'
          AND r.version = COALESCE(
            CASE
              WHEN c.payload ? 'recordVersion' AND (c.payload->>'recordVersion') ~ '^[0-9]+$'
              THEN (c.payload->>'recordVersion')::integer
              ELSE NULL
            END,
            1
          )
          AND (
            (
              c.payload->>'operation' = 'LINE_AI_EDIT'
              AND r.entity_id IS NOT DISTINCT FROM CASE
                WHEN (c.payload->>'previousEntityId') ~ '^[0-9]+$'
                THEN (c.payload->>'previousEntityId')::bigint
                ELSE NULL
              END
              AND EXISTS (
                SELECT 1 FROM worklog_line_ai_edits edit
                WHERE edit.id = CASE
                  WHEN (c.payload->>'lineEditId') ~ '^[0-9]+$'
                  THEN (c.payload->>'lineEditId')::bigint
                  ELSE -1
                END
                  AND edit.source_id = c.source_id
                  AND edit.record_id = c.record_id
                  AND edit.confirmation_id = c.id
                  AND edit.status = 'PENDING_CONFIRMATION'
              )
            )
            OR (COALESCE(c.payload->>'operation', '') <> 'LINE_AI_EDIT' AND r.entity_id IS NULL)
          )
        ) AS record_eligible
      FROM worklog_ai_confirmations c
      INNER JOIN worklog_records r ON r.id = c.record_id AND r.source_id = c.source_id
      WHERE c.id = ${confirmationId}
        AND c.requested_user_id = ${requestedUserId}
        AND c.source_id = ${sourceId}
        AND c.status = 'PENDING'
        AND (c.expires_at IS NULL OR c.expires_at > ${at})
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? stateFromRow(row) : null;
  }

  private async terminalResult(
    confirmationId: number,
    requestedUserId: number,
    sourceId: number,
  ): Promise<WorklogConfirmationResolution> {
    const result = await this.db.execute(sql`
      SELECT c.status, c.id::text AS id, c.record_id::text AS record_id,
             r.entity_id::text AS entity_id, entity.name AS title
      FROM worklog_ai_confirmations c
      LEFT JOIN worklog_records r ON r.id = c.record_id
      LEFT JOIN worklog_entities entity ON entity.id = r.entity_id
      WHERE c.id = ${confirmationId}
        AND c.requested_user_id = ${requestedUserId}
        AND c.source_id = ${sourceId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { status: 'NOT_FOUND' };
    if (row.status === 'REJECTED') {
      return {
        status: 'REJECTED',
        confirmationId: positiveNumber(row.id, 'confirmation id'),
        recordId: positiveNumber(row.record_id, 'record id'),
      };
    }
    if (row.status === 'CONFIRMED' && row.entity_id && row.title) {
      return {
        status: 'CONFIRMED',
        confirmationId: positiveNumber(row.id, 'confirmation id'),
        recordId: positiveNumber(row.record_id, 'record id'),
        entityId: positiveNumber(row.entity_id, 'entity id'),
        title: requiredText(row.title, 'title'),
        createdEntity: false,
        aliasCreated: false,
      };
    }
    return { status: 'NOT_FOUND' };
  }

  private async expireInvalid(requestedUserId: number, sourceId: number, at: Date): Promise<void> {
    await this.db.execute(sql`
      WITH expired AS (
        UPDATE worklog_ai_confirmations c
        SET status = 'EXPIRED', resolved_at = ${at}, updated_at = ${at}
        WHERE c.requested_user_id = ${requestedUserId}
          AND c.source_id = ${sourceId}
          AND c.status = 'PENDING'
          AND (
            (c.expires_at IS NOT NULL AND c.expires_at <= ${at})
            OR NOT EXISTS (
              SELECT 1 FROM worklog_records r
              WHERE r.id = c.record_id
                AND r.source_id = c.source_id
                AND r.status = 'ACTIVE'
                AND r.version = COALESCE(
                  CASE
                    WHEN c.payload ? 'recordVersion' AND (c.payload->>'recordVersion') ~ '^[0-9]+$'
                    THEN (c.payload->>'recordVersion')::integer
                    ELSE NULL
                  END,
                  1
                )
                AND (
                  (
                    c.payload->>'operation' = 'LINE_AI_EDIT'
                    AND r.entity_id IS NOT DISTINCT FROM CASE
                      WHEN (c.payload->>'previousEntityId') ~ '^[0-9]+$'
                      THEN (c.payload->>'previousEntityId')::bigint
                      ELSE NULL
                    END
                    AND EXISTS (
                      SELECT 1 FROM worklog_line_ai_edits edit
                      WHERE edit.id = CASE
                        WHEN (c.payload->>'lineEditId') ~ '^[0-9]+$'
                        THEN (c.payload->>'lineEditId')::bigint
                        ELSE -1
                      END
                        AND edit.source_id = c.source_id
                        AND edit.record_id = c.record_id
                        AND edit.confirmation_id = c.id
                        AND edit.status = 'PENDING_CONFIRMATION'
                    )
                  )
                  OR (COALESCE(c.payload->>'operation', '') <> 'LINE_AI_EDIT' AND r.entity_id IS NULL)
                )
            )
          )
        RETURNING c.id, c.payload
      ), failed_edits AS (
        UPDATE worklog_line_ai_edits edit
        SET status = 'FAILED',
            last_error_code = 'AI_EDIT_CONFIRMATION_EXPIRED_OR_STALE',
            last_error_detail = 'Pending LINE AI edit confirmation expired or its Record changed before resolution.',
            completed_at = COALESCE(edit.completed_at, ${at}),
            updated_at = ${at}
        FROM expired
        WHERE expired.payload->>'operation' = 'LINE_AI_EDIT'
          AND (expired.payload->>'lineEditId') ~ '^[0-9]+$'
          AND edit.id = (expired.payload->>'lineEditId')::bigint
          AND edit.confirmation_id = expired.id
          AND edit.status = 'PENDING_CONFIRMATION'
        RETURNING edit.id
      )
      SELECT COUNT(*) FROM expired
    `);
  }

  private async entity(sourceId: number, entityId: number): Promise<{ id: number; name: string } | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, name FROM worklog_entities
      WHERE id = ${entityId} AND source_id = ${sourceId} AND status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; name?: string } | undefined;
    return row?.id && row.name ? { id: positiveNumber(row.id, 'entity id'), name: row.name } : null;
  }

  private async entityByExactName(sourceId: number, title: string) {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, name FROM worklog_entities
      WHERE source_id = ${sourceId} AND status = 'ACTIVE'
        AND LOWER(BTRIM(name)) = LOWER(BTRIM(${title}))
      LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; name?: string } | undefined;
    return row?.id && row.name ? { id: positiveNumber(row.id, 'entity id'), name: row.name } : null;
  }

  private async exactAliasExists(sourceId: number, title: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM worklog_entity_aliases
      WHERE source_id = ${sourceId} AND LOWER(BTRIM(alias)) = LOWER(BTRIM(${title}))
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  private async titleConflict(sourceId: number, title: string, targetEntityId: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1
      WHERE EXISTS (
        SELECT 1 FROM worklog_entities entity
        WHERE entity.source_id = ${sourceId}
          AND entity.status = 'ACTIVE'
          AND entity.id <> ${targetEntityId}
          AND LOWER(BTRIM(entity.name)) = LOWER(BTRIM(${title}))
      ) OR EXISTS (
        SELECT 1 FROM worklog_entity_aliases alias
        WHERE alias.source_id = ${sourceId}
          AND alias.entity_id <> ${targetEntityId}
          AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(${title}))
      )
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  private async deleteUnusedEntity(entityId: number): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM worklog_entities entity
      WHERE entity.id = ${entityId}
        AND NOT EXISTS (SELECT 1 FROM worklog_records record WHERE record.entity_id = entity.id)
        AND NOT EXISTS (SELECT 1 FROM worklog_entity_aliases alias WHERE alias.entity_id = entity.id)
    `);
  }
}

function candidateAllowed(state: PendingState, entityId: number): boolean {
  return state.candidateEntityId === entityId || state.candidates.some((candidate) => candidate.entityId === entityId);
}

function pendingFromRow(value: unknown): WorklogPendingConfirmation {
  const row = value as Record<string, unknown>;
  const state = stateFromRow({ ...row, record_eligible: true });
  const candidateTitle = typeof row.candidate_title === 'string' && row.candidate_title.trim()
    ? row.candidate_title.trim()
    : null;
  return {
    id: state.id,
    sourceId: state.sourceId,
    recordId: state.recordId,
    requestedUserId: state.requestedUserId,
    confirmationType: state.confirmationType,
    candidateEntityId: state.candidateEntityId,
    candidateTitle,
    proposedName: state.proposedName,
    reason: state.reason,
    operation: state.operation,
    proposedRawText: state.proposedRawText,
    occurredAt: state.occurredAt,
    expectedRecordVersion: state.expectedRecordVersion,
    candidates: state.candidates,
    recordRawText: state.recordRawText,
    expiresAt: state.expiresAt,
    createdAt: state.createdAt,
  };
}

function stateFromRow(row: Record<string, unknown>): PendingState {
  const payload = payloadValue(row.payload);
  return {
    id: positiveNumber(row.id, 'confirmation id'),
    sourceId: positiveNumber(row.source_id, 'source id'),
    recordId: positiveNumber(row.record_id, 'record id'),
    requestedUserId: positiveNumber(row.requested_user_id, 'requested user id'),
    confirmationType: confirmationType(row.confirmation_type),
    candidateEntityId: optionalPositiveNumber(row.candidate_entity_id, 'candidate entity id'),
    proposedName: optionalText(row.proposed_name),
    reason: payload.reason,
    operation: payload.operation,
    proposedRawText: payload.proposedRawText,
    occurredAt: payload.occurredAt,
    expectedRecordVersion: payload.recordVersion,
    previousEntityId: payload.previousEntityId,
    lineEditId: payload.lineEditId,
    candidates: payload.candidates,
    recordRawText: requiredText(row.record_raw_text, 'record raw text'),
    currentOccurredAt: row.current_occurred_at ? dateValue(row.current_occurred_at, 'current occurred at') : payload.occurredAt,
    currentEntityId: optionalPositiveNumber(row.current_entity_id, 'current entity id'),
    recordEligible: Boolean(row.record_eligible),
    expiresAt: row.expires_at == null ? null : dateValue(row.expires_at, 'expires at'),
    createdAt: dateValue(row.created_at, 'created at'),
  };
}

function payloadValue(value: unknown) {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const candidates: WorklogConfirmationCandidate[] = Array.isArray(row.candidates)
    ? row.candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const item = candidate as Record<string, unknown>;
        const entityId = optionalPositiveNumber(item.entityId, 'candidate entity id');
        const name = optionalText(item.name);
        const matchedVia = item.matchedVia;
        if (!entityId || !name || (matchedVia !== 'ENTITY' && matchedVia !== 'ALIAS' && matchedVia !== 'FUZZY')) return [];
        return [{ entityId, name, matchedVia }];
      })
    : [];
  const operation: PendingOperation = row.operation === 'LINE_AI_EDIT' ? 'LINE_AI_EDIT' : 'CREATE_TITLE';
  return {
    reason: optionalText(row.reason),
    operation,
    proposedRawText: operation === 'LINE_AI_EDIT' ? optionalText(row.proposedRawText) : null,
    occurredAt: row.occurredAt ? dateValue(row.occurredAt, 'occurred at') : new Date(0),
    recordVersion: optionalPositiveNumber(row.recordVersion, 'record version') ?? 1,
    previousEntityId: optionalPositiveNumber(row.previousEntityId, 'previous entity id'),
    lineEditId: optionalPositiveNumber(row.lineEditId, 'line edit id'),
    candidates,
  };
}

function confirmationType(value: unknown): WorklogPendingConfirmation['confirmationType'] {
  if (value !== 'ALIAS_MATCH' && value !== 'RECORD_TITLE' && value !== 'ENTITY_MATCH') {
    throw new Error('invalid confirmation type');
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function optionalPositiveNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return positiveNumber(value, label);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${label}`);
  return date;
}
