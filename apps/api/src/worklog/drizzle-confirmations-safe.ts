import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogConfirmationCandidate,
  WorklogConfirmationRepository,
  WorklogConfirmationResolution,
  WorklogPendingConfirmation,
} from './confirmations';

type PendingState = {
  id: number;
  sourceId: number;
  recordId: number;
  requestedUserId: number;
  confirmationType: WorklogPendingConfirmation['confirmationType'];
  candidateEntityId: number | null;
  proposedName: string | null;
  reason: string | null;
  occurredAt: Date;
  expectedRecordVersion: number;
  candidates: WorklogConfirmationCandidate[];
  recordRawText: string;
  recordEligible: boolean;
  expiresAt: Date | null;
  createdAt: Date;
};

/**
 * Safe durable resolver for already-paid AI title ambiguity.
 *
 * It never calls AI. Existing-title resolution performs Record mutation first inside a
 * single SQL statement and only then persists an Alias/CONFIRMED state, so a stale
 * Record cannot leave behind a new Alias. New-title creation uses guarded mutation and
 * removes a just-created unused Entity if a concurrent Record change wins the race.
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
    if (state.confirmationType === 'ALIAS_MATCH' && state.proposedName) {
      const conflict = await this.titleConflict(input.sourceId, state.proposedName, input.entityId);
      if (conflict) return { status: 'TITLE_CONFLICT' };
    }

    const result = await this.db.execute(sql`
      WITH updated_record AS (
        UPDATE worklog_records record
        SET
          entity_id = ${input.entityId},
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
        WHERE ${state.confirmationType} = 'ALIAS_MATCH'
          AND ${state.proposedName}::text IS NOT NULL
          AND BTRIM(${state.proposedName}) <> ''
          AND LOWER(BTRIM(${state.proposedName})) <> LOWER(BTRIM(${entity.name}))
          AND NOT EXISTS (
            SELECT 1 FROM worklog_entity_aliases alias
            WHERE alias.source_id = ${state.sourceId}
              AND alias.entity_id = ${input.entityId}
              AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(${state.proposedName}))
          )
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
      SELECT
        updated_record.id::text AS record_id,
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

    const result = await this.db.execute(sql`
      WITH updated_record AS (
        UPDATE worklog_records record
        SET
          entity_id = ${target.id},
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
      UPDATE worklog_ai_confirmations
      SET status = 'REJECTED',
          resolved_at = ${input.at},
          resolved_by_user_id = ${input.requestedUserId},
          updated_at = ${input.at}
      WHERE id = ${input.confirmationId}
        AND requested_user_id = ${input.requestedUserId}
        AND source_id = ${input.sourceId}
        AND status = 'PENDING'
        AND (expires_at IS NULL OR expires_at > ${input.at})
      RETURNING id::text AS id, record_id::text AS record_id
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
        c.expires_at,
        c.created_at,
        (
          r.status = 'ACTIVE'
          AND r.entity_id IS NULL
          AND r.version = COALESCE(
            CASE
              WHEN c.payload ? 'recordVersion' AND (c.payload->>'recordVersion') ~ '^[0-9]+$'
              THEN (c.payload->>'recordVersion')::integer
              ELSE NULL
            END,
            1
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
              AND r.entity_id IS NULL
              AND r.version = COALESCE(
                CASE
                  WHEN c.payload ? 'recordVersion' AND (c.payload->>'recordVersion') ~ '^[0-9]+$'
                  THEN (c.payload->>'recordVersion')::integer
                  ELSE NULL
                END,
                1
              )
          )
        )
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
    occurredAt: payload.occurredAt,
    expectedRecordVersion: payload.recordVersion,
    candidates: payload.candidates,
    recordRawText: requiredText(row.record_raw_text, 'record raw text'),
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
  return {
    reason: optionalText(row.reason),
    occurredAt: row.occurredAt ? dateValue(row.occurredAt, 'occurred at') : new Date(0),
    recordVersion: optionalPositiveNumber(row.recordVersion, 'record version') ?? 1,
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
