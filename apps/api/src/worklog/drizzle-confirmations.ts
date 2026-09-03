import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogConfirmationCandidate,
  WorklogConfirmationRepository,
  WorklogConfirmationResolution,
  WorklogPendingConfirmation,
} from './confirmations';

type ConfirmationRow = {
  id: string | number;
  source_id: string | number;
  record_id: string | number;
  requested_user_id: string | number;
  confirmation_type: string;
  candidate_entity_id: string | number | null;
  candidate_title: string | null;
  proposed_name: string | null;
  payload: unknown;
  record_raw_text: string;
  expires_at: Date | string | null;
  created_at: Date | string;
};

type ResolutionRow = {
  confirmation_id: string | number;
  record_id: string | number;
  entity_id: string | number;
  title: string;
  created_entity?: boolean;
  alias_created?: boolean;
};

export class DrizzleWorklogConfirmationRepository implements WorklogConfirmationRepository {
  constructor(private readonly db: Database) {}

  async listPending(input: {
    requestedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogPendingConfirmation[]> {
    // A confirmation is only actionable while the exact unresolved Record state that
    // produced it still exists. Manual edit/delete/title assignment invalidates it.
    await this.db.execute(sql`
      UPDATE worklog_ai_confirmations confirmation
      SET status = 'EXPIRED', resolved_at = ${input.at}, updated_at = ${input.at}
      WHERE confirmation.requested_user_id = ${input.requestedUserId}
        AND confirmation.source_id = ${input.sourceId}
        AND confirmation.status = 'PENDING'
        AND (
          (confirmation.expires_at IS NOT NULL AND confirmation.expires_at <= ${input.at})
          OR NOT EXISTS (
            SELECT 1
            FROM worklog_records record
            WHERE record.id = confirmation.record_id
              AND record.source_id = confirmation.source_id
              AND record.status = 'ACTIVE'
              AND record.entity_id IS NULL
              AND record.version = COALESCE(
                CASE
                  WHEN confirmation.payload ? 'recordVersion'
                    AND (confirmation.payload->>'recordVersion') ~ '^[0-9]+$'
                  THEN (confirmation.payload->>'recordVersion')::integer
                  ELSE NULL
                END,
                1
              )
          )
        )
    `);

    const result = await this.db.execute(sql`
      SELECT
        confirmation.id::text AS id,
        confirmation.source_id::text AS source_id,
        confirmation.record_id::text AS record_id,
        confirmation.requested_user_id::text AS requested_user_id,
        confirmation.confirmation_type,
        confirmation.candidate_entity_id::text AS candidate_entity_id,
        candidate.name AS candidate_title,
        confirmation.proposed_name,
        confirmation.payload,
        record.raw_text AS record_raw_text,
        confirmation.expires_at,
        confirmation.created_at
      FROM worklog_ai_confirmations confirmation
      INNER JOIN worklog_records record
        ON record.id = confirmation.record_id
       AND record.source_id = confirmation.source_id
      LEFT JOIN worklog_entities candidate
        ON candidate.id = confirmation.candidate_entity_id
       AND candidate.source_id = confirmation.source_id
      WHERE confirmation.requested_user_id = ${input.requestedUserId}
        AND confirmation.source_id = ${input.sourceId}
        AND confirmation.status = 'PENDING'
        AND (confirmation.expires_at IS NULL OR confirmation.expires_at > ${input.at})
      ORDER BY confirmation.created_at ASC, confirmation.id ASC
      LIMIT 50
    `);

    return (result.rows as ConfirmationRow[]).map((row) => pendingConfirmation(row));
  }

  async resolveExisting(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    entityId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const result = await this.db.execute(sql`
      WITH confirmation AS (
        SELECT
          c.*,
          COALESCE(
            CASE
              WHEN c.payload ? 'recordVersion' AND (c.payload->>'recordVersion') ~ '^[0-9]+$'
              THEN (c.payload->>'recordVersion')::integer
              ELSE NULL
            END,
            1
          ) AS expected_record_version
        FROM worklog_ai_confirmations c
        WHERE c.id = ${input.confirmationId}
          AND c.requested_user_id = ${input.requestedUserId}
          AND c.source_id = ${input.sourceId}
          AND c.status = 'PENDING'
          AND (c.expires_at IS NULL OR c.expires_at > ${input.at})
      ), target AS (
        SELECT c.*, entity.id AS target_entity_id, entity.name AS target_title
        FROM confirmation c
        INNER JOIN worklog_entities entity
          ON entity.id = ${input.entityId}
         AND entity.source_id = c.source_id
         AND entity.status = 'ACTIVE'
        WHERE (
          c.candidate_entity_id = entity.id
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(c.payload->'candidates', '[]'::jsonb)) candidate
            WHERE (candidate->>'entityId') ~ '^[0-9]+$'
              AND (candidate->>'entityId')::bigint = entity.id
          )
        )
        AND (
          c.confirmation_type <> 'ALIAS_MATCH'
          OR c.proposed_name IS NULL
          OR BTRIM(c.proposed_name) = ''
          OR LOWER(BTRIM(c.proposed_name)) = LOWER(BTRIM(entity.name))
          OR (
            NOT EXISTS (
              SELECT 1 FROM worklog_entities conflict_entity
              WHERE conflict_entity.source_id = c.source_id
                AND conflict_entity.status = 'ACTIVE'
                AND conflict_entity.id <> entity.id
                AND LOWER(BTRIM(conflict_entity.name)) = LOWER(BTRIM(c.proposed_name))
            )
            AND NOT EXISTS (
              SELECT 1 FROM worklog_entity_aliases conflict_alias
              WHERE conflict_alias.source_id = c.source_id
                AND conflict_alias.entity_id <> entity.id
                AND LOWER(BTRIM(conflict_alias.alias)) = LOWER(BTRIM(c.proposed_name))
            )
          )
        )
      ), alias_insert AS (
        INSERT INTO worklog_entity_aliases (
          source_id, entity_id, alias, created_by_user_id, created_via, created_at, updated_at
        )
        SELECT
          target.source_id,
          target.target_entity_id,
          BTRIM(target.proposed_name),
          ${input.requestedUserId},
          'AI_CONFIRMATION',
          ${input.at},
          ${input.at}
        FROM target
        WHERE target.confirmation_type = 'ALIAS_MATCH'
          AND target.proposed_name IS NOT NULL
          AND BTRIM(target.proposed_name) <> ''
          AND LOWER(BTRIM(target.proposed_name)) <> LOWER(BTRIM(target.target_title))
          AND NOT EXISTS (
            SELECT 1 FROM worklog_entity_aliases existing_alias
            WHERE existing_alias.source_id = target.source_id
              AND existing_alias.entity_id = target.target_entity_id
              AND LOWER(BTRIM(existing_alias.alias)) = LOWER(BTRIM(target.proposed_name))
          )
        ON CONFLICT (source_id, alias) DO NOTHING
        RETURNING id
      ), updated_record AS (
        UPDATE worklog_records record
        SET
          entity_id = target.target_entity_id,
          occurred_at = CASE
            WHEN target.payload ? 'occurredAt'
              THEN (target.payload->>'occurredAt')::timestamptz
            ELSE record.occurred_at
          END,
          updated_at = ${input.at}
        FROM target
        WHERE record.id = target.record_id
          AND record.source_id = target.source_id
          AND record.status = 'ACTIVE'
          AND record.entity_id IS NULL
          AND record.version = target.expected_record_version
        RETURNING
          record.id,
          target.id AS confirmation_id,
          target.target_entity_id AS entity_id,
          target.target_title AS title,
          target.confirmation_type,
          target.proposed_name
      ), resolved AS (
        UPDATE worklog_ai_confirmations confirmation
        SET
          status = 'CONFIRMED',
          resolved_at = ${input.at},
          resolved_by_user_id = ${input.requestedUserId},
          updated_at = ${input.at}
        FROM updated_record record
        WHERE confirmation.id = record.confirmation_id
          AND confirmation.status = 'PENDING'
        RETURNING confirmation.id
      )
      SELECT
        updated_record.confirmation_id::text AS confirmation_id,
        updated_record.id::text AS record_id,
        updated_record.entity_id::text AS entity_id,
        updated_record.title,
        FALSE AS created_entity,
        EXISTS (SELECT 1 FROM alias_insert) AS alias_created
      FROM updated_record
      INNER JOIN resolved ON resolved.id = updated_record.confirmation_id
      LIMIT 1
    `);

    const row = result.rows[0] as ResolutionRow | undefined;
    if (row) return confirmedResolution(row);
    return this.explainExistingFailure(input);
  }

  async resolveNewTitle(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    title: string;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const result = await this.db.execute(sql`
      WITH confirmation AS (
        SELECT
          c.*,
          COALESCE(NULLIF(BTRIM(${input.title}), ''), NULLIF(BTRIM(c.proposed_name), '')) AS resolved_title,
          COALESCE(
            CASE
              WHEN c.payload ? 'recordVersion' AND (c.payload->>'recordVersion') ~ '^[0-9]+$'
              THEN (c.payload->>'recordVersion')::integer
              ELSE NULL
            END,
            1
          ) AS expected_record_version
        FROM worklog_ai_confirmations c
        WHERE c.id = ${input.confirmationId}
          AND c.requested_user_id = ${input.requestedUserId}
          AND c.source_id = ${input.sourceId}
          AND c.status = 'PENDING'
          AND (c.expires_at IS NULL OR c.expires_at > ${input.at})
      ), valid_title AS (
        SELECT c.*
        FROM confirmation c
        WHERE c.resolved_title IS NOT NULL
          AND LENGTH(c.resolved_title) <= 255
          AND NOT EXISTS (
            SELECT 1 FROM worklog_entity_aliases alias
            WHERE alias.source_id = c.source_id
              AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(c.resolved_title))
          )
      ), existing_entity AS (
        SELECT entity.id, entity.name, valid_title.id AS confirmation_id
        FROM valid_title
        INNER JOIN worklog_entities entity
          ON entity.source_id = valid_title.source_id
         AND entity.status = 'ACTIVE'
         AND LOWER(BTRIM(entity.name)) = LOWER(BTRIM(valid_title.resolved_title))
        LIMIT 1
      ), inserted_entity AS (
        INSERT INTO worklog_entities (source_id, name, status, created_at, updated_at)
        SELECT valid_title.source_id, valid_title.resolved_title, 'ACTIVE', ${input.at}, ${input.at}
        FROM valid_title
        WHERE NOT EXISTS (SELECT 1 FROM existing_entity)
        ON CONFLICT (source_id, name) DO UPDATE SET updated_at = worklog_entities.updated_at
        RETURNING id, name
      ), target_entity AS (
        SELECT id, name, FALSE AS created_entity FROM existing_entity
        UNION ALL
        SELECT id, name, TRUE AS created_entity FROM inserted_entity
        LIMIT 1
      ), updated_record AS (
        UPDATE worklog_records record
        SET
          entity_id = target_entity.id,
          occurred_at = CASE
            WHEN valid_title.payload ? 'occurredAt'
              THEN (valid_title.payload->>'occurredAt')::timestamptz
            ELSE record.occurred_at
          END,
          updated_at = ${input.at}
        FROM valid_title, target_entity
        WHERE record.id = valid_title.record_id
          AND record.source_id = valid_title.source_id
          AND record.status = 'ACTIVE'
          AND record.entity_id IS NULL
          AND record.version = valid_title.expected_record_version
        RETURNING
          record.id,
          valid_title.id AS confirmation_id,
          target_entity.id AS entity_id,
          target_entity.name AS title,
          target_entity.created_entity
      ), resolved AS (
        UPDATE worklog_ai_confirmations confirmation
        SET
          status = 'CONFIRMED',
          resolved_at = ${input.at},
          resolved_by_user_id = ${input.requestedUserId},
          updated_at = ${input.at}
        FROM updated_record record
        WHERE confirmation.id = record.confirmation_id
          AND confirmation.status = 'PENDING'
        RETURNING confirmation.id
      )
      SELECT
        updated_record.confirmation_id::text AS confirmation_id,
        updated_record.id::text AS record_id,
        updated_record.entity_id::text AS entity_id,
        updated_record.title,
        updated_record.created_entity,
        FALSE AS alias_created
      FROM updated_record
      INNER JOIN resolved ON resolved.id = updated_record.confirmation_id
      LIMIT 1
    `);

    const row = result.rows[0] as ResolutionRow | undefined;
    if (row) return confirmedResolution(row);
    return this.explainNewTitleFailure(input);
  }

  async reject(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const result = await this.db.execute(sql`
      UPDATE worklog_ai_confirmations confirmation
      SET
        status = 'REJECTED',
        resolved_at = ${input.at},
        resolved_by_user_id = ${input.requestedUserId},
        updated_at = ${input.at}
      WHERE confirmation.id = ${input.confirmationId}
        AND confirmation.requested_user_id = ${input.requestedUserId}
        AND confirmation.source_id = ${input.sourceId}
        AND confirmation.status = 'PENDING'
        AND (confirmation.expires_at IS NULL OR confirmation.expires_at > ${input.at})
      RETURNING confirmation.id::text AS confirmation_id, confirmation.record_id::text AS record_id
    `);
    const row = result.rows[0] as { confirmation_id?: string; record_id?: string } | undefined;
    if (row?.confirmation_id && row.record_id) {
      return {
        status: 'REJECTED',
        confirmationId: positiveNumber(row.confirmation_id, 'confirmation id'),
        recordId: positiveNumber(row.record_id, 'record id'),
      };
    }
    return this.existingTerminalResult(input.confirmationId, input.requestedUserId, input.sourceId);
  }

  private async explainExistingFailure(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    entityId: number;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const terminal = await this.existingTerminalResult(input.confirmationId, input.requestedUserId, input.sourceId);
    if (terminal.status !== 'NOT_FOUND') return terminal;

    const state = await this.loadPendingState(input.confirmationId, input.requestedUserId, input.sourceId, input.at);
    if (!state) return { status: 'NOT_FOUND' };
    if (!state.recordEligible) return { status: 'RECORD_CHANGED' };
    if (!state.entityAllowed) return { status: 'ENTITY_NOT_ALLOWED' };
    if (state.aliasConflict) return { status: 'TITLE_CONFLICT' };
    return { status: 'RECORD_CHANGED' };
  }

  private async explainNewTitleFailure(input: {
    confirmationId: number;
    requestedUserId: number;
    sourceId: number;
    title: string;
    at: Date;
  }): Promise<WorklogConfirmationResolution> {
    const terminal = await this.existingTerminalResult(input.confirmationId, input.requestedUserId, input.sourceId);
    if (terminal.status !== 'NOT_FOUND') return terminal;

    const state = await this.loadPendingState(input.confirmationId, input.requestedUserId, input.sourceId, input.at);
    if (!state) return { status: 'NOT_FOUND' };
    if (!state.recordEligible) return { status: 'RECORD_CHANGED' };
    const title = input.title.trim() || state.proposedName?.trim() || '';
    if (!title || title.length > 255) return { status: 'TITLE_REQUIRED' };
    if (await this.aliasExists(state.sourceId, title)) return { status: 'TITLE_CONFLICT' };
    return { status: 'RECORD_CHANGED' };
  }

  private async existingTerminalResult(
    confirmationId: number,
    requestedUserId: number,
    sourceId: number,
  ): Promise<WorklogConfirmationResolution> {
    const result = await this.db.execute(sql`
      SELECT
        confirmation.status,
        confirmation.id::text AS confirmation_id,
        confirmation.record_id::text AS record_id,
        record.entity_id::text AS entity_id,
        entity.name AS title
      FROM worklog_ai_confirmations confirmation
      LEFT JOIN worklog_records record ON record.id = confirmation.record_id
      LEFT JOIN worklog_entities entity ON entity.id = record.entity_id
      WHERE confirmation.id = ${confirmationId}
        AND confirmation.requested_user_id = ${requestedUserId}
        AND confirmation.source_id = ${sourceId}
      LIMIT 1
    `);
    const row = result.rows[0] as {
      status?: string;
      confirmation_id?: string;
      record_id?: string;
      entity_id?: string | null;
      title?: string | null;
    } | undefined;
    if (!row) return { status: 'NOT_FOUND' };
    if (row.status === 'REJECTED' && row.confirmation_id && row.record_id) {
      return {
        status: 'REJECTED',
        confirmationId: positiveNumber(row.confirmation_id, 'confirmation id'),
        recordId: positiveNumber(row.record_id, 'record id'),
      };
    }
    if (row.status === 'CONFIRMED' && row.confirmation_id && row.record_id && row.entity_id && row.title) {
      return {
        status: 'CONFIRMED',
        confirmationId: positiveNumber(row.confirmation_id, 'confirmation id'),
        recordId: positiveNumber(row.record_id, 'record id'),
        entityId: positiveNumber(row.entity_id, 'entity id'),
        title: row.title,
        createdEntity: false,
        aliasCreated: false,
      };
    }
    return { status: 'NOT_FOUND' };
  }

  private async loadPendingState(
    confirmationId: number,
    requestedUserId: number,
    sourceId: number,
    at: Date,
  ): Promise<{
    sourceId: number;
    proposedName: string | null;
    recordEligible: boolean;
    entityAllowed: boolean;
    aliasConflict: boolean;
  } | null> {
    const result = await this.db.execute(sql`
      SELECT
        confirmation.source_id::text AS source_id,
        confirmation.proposed_name,
        EXISTS (
          SELECT 1 FROM worklog_records record
          WHERE record.id = confirmation.record_id
            AND record.source_id = confirmation.source_id
            AND record.status = 'ACTIVE'
            AND record.entity_id IS NULL
            AND record.version = COALESCE(
              CASE
                WHEN confirmation.payload ? 'recordVersion'
                  AND (confirmation.payload->>'recordVersion') ~ '^[0-9]+$'
                THEN (confirmation.payload->>'recordVersion')::integer
                ELSE NULL
              END,
              1
            )
        ) AS record_eligible,
        EXISTS (
          SELECT 1 FROM worklog_entities entity
          WHERE entity.id = ${0}
        ) AS entity_allowed,
        FALSE AS alias_conflict
      FROM worklog_ai_confirmations confirmation
      WHERE confirmation.id = ${confirmationId}
        AND confirmation.requested_user_id = ${requestedUserId}
        AND confirmation.source_id = ${sourceId}
        AND confirmation.status = 'PENDING'
        AND (confirmation.expires_at IS NULL OR confirmation.expires_at > ${at})
      LIMIT 1
    `);
    const row = result.rows[0] as {
      source_id?: string;
      proposed_name?: string | null;
      record_eligible?: boolean;
    } | undefined;
    if (!row?.source_id) return null;
    return {
      sourceId: positiveNumber(row.source_id, 'source id'),
      proposedName: row.proposed_name ?? null,
      recordEligible: Boolean(row.record_eligible),
      entityAllowed: true,
      aliasConflict: false,
    };
  }

  private async aliasExists(sourceId: number, title: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1
      FROM worklog_entity_aliases
      WHERE source_id = ${sourceId}
        AND LOWER(BTRIM(alias)) = LOWER(BTRIM(${title}))
      LIMIT 1
    `);
    return result.rows.length > 0;
  }
}

function pendingConfirmation(row: ConfirmationRow): WorklogPendingConfirmation {
  const payload = confirmationPayload(row.payload);
  const confirmationType = confirmationTypeValue(row.confirmation_type);
  return {
    id: positiveNumber(row.id, 'confirmation id'),
    sourceId: positiveNumber(row.source_id, 'source id'),
    recordId: positiveNumber(row.record_id, 'record id'),
    requestedUserId: positiveNumber(row.requested_user_id, 'requested user id'),
    confirmationType,
    candidateEntityId: optionalPositiveNumber(row.candidate_entity_id, 'candidate entity id'),
    candidateTitle: row.candidate_title?.trim() || null,
    proposedName: row.proposed_name?.trim() || null,
    reason: payload.reason,
    occurredAt: payload.occurredAt,
    expectedRecordVersion: payload.recordVersion,
    candidates: payload.candidates,
    recordRawText: requiredText(row.record_raw_text, 'record raw text'),
    expiresAt: row.expires_at === null ? null : dateValue(row.expires_at, 'expires at'),
    createdAt: dateValue(row.created_at, 'created at'),
  };
}

function confirmationPayload(value: unknown): {
  reason: string | null;
  occurredAt: Date;
  recordVersion: number;
  candidates: WorklogConfirmationCandidate[];
} {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const candidates = Array.isArray(row.candidates)
    ? row.candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const item = candidate as Record<string, unknown>;
        const entityId = optionalPositiveNumber(item.entityId, 'candidate entity id');
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const matchedVia = item.matchedVia;
        if (!entityId || !name || (matchedVia !== 'ENTITY' && matchedVia !== 'ALIAS' && matchedVia !== 'FUZZY')) return [];
        return [{ entityId, name, matchedVia } satisfies WorklogConfirmationCandidate];
      })
    : [];
  return {
    reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim().slice(0, 128) : null,
    occurredAt: row.occurredAt ? dateValue(row.occurredAt, 'payload occurredAt') : new Date(0),
    recordVersion: optionalPositiveNumber(row.recordVersion, 'record version') ?? 1,
    candidates,
  };
}

function confirmedResolution(row: ResolutionRow): WorklogConfirmationResolution {
  return {
    status: 'CONFIRMED',
    confirmationId: positiveNumber(row.confirmation_id, 'confirmation id'),
    recordId: positiveNumber(row.record_id, 'record id'),
    entityId: positiveNumber(row.entity_id, 'entity id'),
    title: requiredText(row.title, 'title'),
    createdEntity: Boolean(row.created_entity),
    aliasCreated: Boolean(row.alias_created),
  };
}

function confirmationTypeValue(value: string): WorklogPendingConfirmation['confirmationType'] {
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

function dateValue(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${label}`);
  return date;
}
