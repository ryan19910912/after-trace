import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogInterpretedRecordApplyResult,
  WorklogInterpretedRecordRepository,
} from './interpreted-record';
import type { WorklogTextNormalizationOutput } from './text-normalization';

type RecordRow = {
  id: string | number;
  source_id: string | number;
  author_user_id: string | number;
  entity_id: string | number | null;
  occurred_at: Date | string;
  status: 'ACTIVE' | 'DELETED';
  version: string | number;
};
type Candidate = { entityId: number; name: string; matchedVia: 'ENTITY' | 'ALIAS' | 'FUZZY' };

/**
 * Deterministic persistence for RECORD fields already returned by the one-call LINE
 * interpreter. It deliberately contains no provider dependency.
 */
export class DrizzleWorklogInterpretedRecordRepository implements WorklogInterpretedRecordRepository {
  constructor(private readonly db: Database) {}

  async apply(input: {
    recordId: number;
    actorUserId: number;
    output: WorklogTextNormalizationOutput;
  }): Promise<WorklogInterpretedRecordApplyResult> {
    const record = await this.loadRecord(input.recordId);
    if (!record || record.status !== 'ACTIVE' || record.version !== 1 || record.authorUserId !== input.actorUserId) {
      return { status: 'RECORD_CHANGED' };
    }
    if (record.entityId !== null) return { status: 'ALREADY_APPLIED', entityId: record.entityId };

    const occurredAt = input.output.occurredAt ? validDate(input.output.occurredAt) : record.occurredAt;
    const searchTerms = normalizeSearchTerms(input.output.searchTerms);
    await this.persistSearchTerms(record.id, searchTerms);

    const title = input.output.title?.trim() || null;
    if (!title) {
      const confirmationId = await this.ensureConfirmation({
        record,
        actorUserId: input.actorUserId,
        proposedName: null,
        candidate: null,
        candidates: [],
        occurredAt,
        reason: 'AI_NO_CLEAR_TITLE',
      });
      await this.rememberInterpretation(record.id, input.output);
      return { status: 'PENDING_CONFIRMATION', confirmationId };
    }

    const exact = await this.findExactCandidates(record.sourceId, title);
    if (input.output.titleRequiresConfirmation || exact.length > 1) {
      const confirmationId = await this.ensureConfirmation({
        record,
        actorUserId: input.actorUserId,
        proposedName: title,
        candidate: exact.length === 1 ? exact[0] : null,
        candidates: exact,
        occurredAt,
        reason: input.output.titleRequiresConfirmation ? 'AI_TITLE_REQUIRES_CONFIRMATION' : 'MULTIPLE_EXACT_TITLE_MATCHES',
      });
      await this.rememberInterpretation(record.id, input.output);
      return { status: 'PENDING_CONFIRMATION', confirmationId };
    }

    if (exact.length === 1) {
      const applied = await this.attach(record.id, record.sourceId, exact[0].entityId, occurredAt);
      await this.rememberInterpretation(record.id, input.output);
      return applied ? { status: 'APPLIED', entityId: exact[0].entityId, createdEntity: false } : { status: 'RECORD_CHANGED' };
    }

    const fuzzy = await this.findPotentialCandidates(record.sourceId, title);
    if (fuzzy.length > 0) {
      const confirmationId = await this.ensureConfirmation({
        record,
        actorUserId: input.actorUserId,
        proposedName: title,
        candidate: fuzzy.length === 1 ? fuzzy[0] : null,
        candidates: fuzzy,
        occurredAt,
        reason: 'POSSIBLE_EXISTING_TITLE',
      });
      await this.rememberInterpretation(record.id, input.output);
      return { status: 'PENDING_CONFIRMATION', confirmationId };
    }

    const entityId = await this.createEntity(record.sourceId, title);
    const applied = await this.attach(record.id, record.sourceId, entityId, occurredAt);
    await this.rememberInterpretation(record.id, input.output);
    return applied ? { status: 'APPLIED', entityId, createdEntity: true } : { status: 'RECORD_CHANGED' };
  }

  private async loadRecord(recordId: number): Promise<{
    id: number;
    sourceId: number;
    authorUserId: number;
    entityId: number | null;
    occurredAt: Date;
    status: 'ACTIVE' | 'DELETED';
    version: number;
  } | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, source_id::text AS source_id,
             author_user_id::text AS author_user_id, entity_id::text AS entity_id,
             occurred_at, status, version
      FROM worklog_records
      WHERE id = ${recordId}
      LIMIT 1
    `);
    const row = result.rows[0] as RecordRow | undefined;
    if (!row) return null;
    return {
      id: number(row.id),
      sourceId: number(row.source_id),
      authorUserId: number(row.author_user_id),
      entityId: row.entity_id == null ? null : number(row.entity_id),
      occurredAt: validDate(row.occurred_at),
      status: row.status,
      version: number(row.version),
    };
  }

  private async persistSearchTerms(recordId: number, terms: string[]): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_records
      SET search_terms = ${JSON.stringify(terms)}::jsonb,
          updated_at = NOW()
      WHERE id = ${recordId}
        AND status = 'ACTIVE'
        AND version = 1
        AND entity_id IS NULL
    `);
  }

  private async attach(recordId: number, sourceId: number, entityId: number, occurredAt: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE worklog_records AS record
      SET entity_id = ${entityId}, occurred_at = ${occurredAt}, updated_at = NOW()
      WHERE record.id = ${recordId}
        AND record.source_id = ${sourceId}
        AND record.status = 'ACTIVE'
        AND record.version = 1
        AND record.entity_id IS NULL
        AND EXISTS (
          SELECT 1 FROM worklog_entities entity
          WHERE entity.id = ${entityId}
            AND entity.source_id = record.source_id
            AND entity.status = 'ACTIVE'
        )
      RETURNING record.id
    `);
    return result.rows.length > 0;
  }

  private async findExactCandidates(sourceId: number, title: string): Promise<Candidate[]> {
    const result = await this.db.execute(sql`
      SELECT matched.entity_id::text AS entity_id, matched.name, matched.matched_via
      FROM (
        SELECT entity.id AS entity_id, entity.name, 'ENTITY'::text AS matched_via
        FROM worklog_entities entity
        WHERE entity.source_id = ${sourceId}
          AND entity.status = 'ACTIVE'
          AND LOWER(BTRIM(entity.name)) = LOWER(BTRIM(${title}))
        UNION ALL
        SELECT alias.entity_id, entity.name, 'ALIAS'::text AS matched_via
        FROM worklog_entity_aliases alias
        INNER JOIN worklog_entities entity
          ON entity.id = alias.entity_id
         AND entity.source_id = alias.source_id
         AND entity.status = 'ACTIVE'
        WHERE alias.source_id = ${sourceId}
          AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(${title}))
      ) matched
      ORDER BY matched.entity_id
    `);
    const seen = new Set<number>();
    const values: Candidate[] = [];
    for (const row of result.rows as Array<{ entity_id: string; name: string; matched_via: 'ENTITY' | 'ALIAS' }>) {
      const entityId = number(row.entity_id);
      if (seen.has(entityId)) continue;
      seen.add(entityId);
      values.push({ entityId, name: row.name, matchedVia: row.matched_via });
    }
    return values;
  }

  private async findPotentialCandidates(sourceId: number, title: string): Promise<Candidate[]> {
    if (Array.from(title).length < 3) return [];
    const result = await this.db.execute(sql`
      SELECT DISTINCT entity.id::text AS entity_id, entity.name
      FROM worklog_entities entity
      LEFT JOIN worklog_entity_aliases alias
        ON alias.entity_id = entity.id AND alias.source_id = entity.source_id
      WHERE entity.source_id = ${sourceId}
        AND entity.status = 'ACTIVE'
        AND (
          POSITION(LOWER(${title}) IN LOWER(entity.name)) > 0
          OR POSITION(LOWER(entity.name) IN LOWER(${title})) > 0
          OR (alias.alias IS NOT NULL AND (
            POSITION(LOWER(${title}) IN LOWER(alias.alias)) > 0
            OR POSITION(LOWER(alias.alias) IN LOWER(${title})) > 0
          ))
        )
      ORDER BY entity.name
      LIMIT 5
    `);
    return (result.rows as Array<{ entity_id: string; name: string }>).map((row) => ({
      entityId: number(row.entity_id), name: row.name, matchedVia: 'FUZZY' as const,
    }));
  }

  private async createEntity(sourceId: number, title: string): Promise<number> {
    const result = await this.db.execute(sql`
      INSERT INTO worklog_entities (source_id, name, status, created_at, updated_at)
      VALUES (${sourceId}, ${title.slice(0, 255)}, 'ACTIVE', NOW(), NOW())
      ON CONFLICT (source_id, name) DO UPDATE SET updated_at = worklog_entities.updated_at
      RETURNING id::text AS id
    `);
    return number((result.rows[0] as { id?: string } | undefined)?.id);
  }

  private async ensureConfirmation(input: {
    record: { id: number; sourceId: number };
    actorUserId: number;
    proposedName: string | null;
    candidate: Candidate | null;
    candidates: Candidate[];
    occurredAt: Date;
    reason: string;
  }): Promise<number> {
    const existing = await this.db.execute(sql`
      SELECT id::text AS id
      FROM worklog_ai_confirmations
      WHERE record_id = ${input.record.id}
        AND requested_user_id = ${input.actorUserId}
        AND status = 'PENDING'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const existingId = (existing.rows[0] as { id?: string } | undefined)?.id;
    if (existingId) return number(existingId);

    const payload = JSON.stringify({
      reason: input.reason,
      proposedTitle: input.proposedName,
      occurredAt: input.occurredAt.toISOString(),
      candidates: input.candidates.map((candidate) => ({
        entityId: candidate.entityId,
        name: candidate.name,
        matchedVia: candidate.matchedVia,
      })),
    });
    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_ai_confirmations (
        source_id, record_id, requested_user_id, confirmation_type,
        candidate_entity_id, proposed_name, payload, status,
        expires_at, created_at, updated_at
      ) VALUES (
        ${input.record.sourceId}, ${input.record.id}, ${input.actorUserId},
        ${input.candidate ? 'ALIAS_MATCH' : 'RECORD_TITLE'},
        ${input.candidate?.entityId ?? null}, ${input.proposedName}, ${payload}::jsonb,
        'PENDING', NOW() + INTERVAL '7 days', NOW(), NOW()
      )
      RETURNING id::text AS id
    `);
    return number((inserted.rows[0] as { id?: string } | undefined)?.id);
  }

  private async rememberInterpretation(recordId: number, output: WorklogTextNormalizationOutput): Promise<void> {
    const claimToken = crypto.randomUUID();
    await this.db.execute(sql`
      INSERT INTO worklog_record_ai_normalizations (
        record_id, status, claim_token, result_json,
        usage_committed_at, completed_at, created_at, updated_at
      ) VALUES (
        ${recordId}, 'SUCCEEDED', ${claimToken}, ${JSON.stringify(output)}::jsonb,
        NOW(), NOW(), NOW(), NOW()
      )
      ON CONFLICT (record_id) DO NOTHING
    `);
  }
}

function normalizeSearchTerms(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (!item || item.length > 64) continue;
    const key = item.toLocaleLowerCase('zh-TW');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= 12) break;
  }
  return result;
}
function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('invalid positive numeric value');
  return parsed;
}
function validDate(value: unknown): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid date');
  return parsed;
}
