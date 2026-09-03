import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { WorklogAiUsageCommit } from './subscription';
import {
  normalizeWorklogTextOutput,
  type WorklogAiRuntimeConfigSnapshot,
  type WorklogPersistedNormalizationPayload,
  type WorklogTextApplyResult,
  type WorklogTextNormalizationBeginResult,
  type WorklogTextNormalizationContext,
  type WorklogTextNormalizationOutput,
  type WorklogTextNormalizationRepository,
} from './text-normalization';

type NormalizationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROVIDER_SUCCEEDED'
  | 'USAGE_COMMITTED'
  | 'SUCCEEDED'
  | 'FAILED';

type NormalizationStateRow = {
  record_id: string | number;
  status: NormalizationStatus;
  claim_token: string;
  reservation_token: string | null;
  result_json: unknown;
  usage_commit_json: unknown;
};

type ContextRow = {
  record_id: string | number;
  workspace_id: string | number;
  source_id: string | number;
  actor_user_id: string | number;
  charged_user_id: string | number;
  raw_text: string;
  occurred_at: Date | string;
};

type RuntimeConfigRow = {
  provider: string;
  model: string;
  input_usd_per_million: string | number;
  output_usd_per_million: string | number;
  audio_usd_per_million: string | number | null;
  image_usd_per_million: string | number | null;
  usd_twd_rate: string | number | null;
};

type TargetRecordRow = {
  id: string | number;
  source_id: string | number;
  author_user_id: string | number | null;
  entity_id: string | number | null;
  raw_text: string;
  occurred_at: Date | string;
  status: 'ACTIVE' | 'DELETED';
  version: string | number;
};

type EntityCandidate = {
  entityId: number;
  name: string;
  matchedVia: 'ENTITY' | 'ALIAS' | 'FUZZY';
};

export class DrizzleWorklogTextNormalizationRepository implements WorklogTextNormalizationRepository {
  constructor(private readonly db: Database) {}

  async begin(recordId: number, claimToken: string): Promise<WorklogTextNormalizationBeginResult> {
    // If a Worker disappeared after the provider may have returned but before the
    // result became durable, never reclaim and issue another provider call.
    await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET status = 'FAILED',
          last_error_code = 'AI_NORMALIZATION_PROCESSING_STALE_UNCERTAIN',
          last_error_detail = 'Provider execution or provider-result persistence became uncertain; automatic replay is disabled.',
          updated_at = NOW()
      WHERE record_id = ${recordId}
        AND status = 'PROCESSING'
        AND updated_at < NOW() - INTERVAL '15 minutes'
    `);

    const current = await this.loadState(recordId);
    if (current) {
      if (current.status === 'PENDING') {
        const claimed = await this.db.execute(sql`
          UPDATE worklog_record_ai_normalizations
          SET
            status = 'PROCESSING',
            claim_token = ${claimToken},
            reservation_token = NULL,
            result_json = NULL,
            usage_commit_json = NULL,
            provider_response_id = NULL,
            latency_ms = NULL,
            last_error_code = NULL,
            last_error_detail = NULL,
            started_at = NOW(),
            provider_succeeded_at = NULL,
            usage_committed_at = NULL,
            completed_at = NULL,
            updated_at = NOW()
          WHERE record_id = ${recordId}
            AND status = 'PENDING'
          RETURNING record_id
        `);
        if (claimed.rows.length > 0) {
          const context = await this.loadContext(recordId);
          if (!context) {
            await this.db.execute(sql`
              UPDATE worklog_record_ai_normalizations
              SET status = 'FAILED', last_error_code = 'RECORD_NOT_ELIGIBLE', updated_at = NOW()
              WHERE record_id = ${recordId}
                AND claim_token = ${claimToken}
                AND status = 'PROCESSING'
            `);
            return { status: 'NOT_ELIGIBLE' };
          }
          return { status: 'CLAIMED', context, claimToken };
        }
        const winner = await this.loadState(recordId);
        return winner ? stateResult(winner) : { status: 'NOT_ELIGIBLE' };
      }
      return stateResult(current);
    }

    const context = await this.loadContext(recordId);
    if (!context) return { status: 'NOT_ELIGIBLE' };

    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_record_ai_normalizations (
        record_id,
        status,
        claim_token,
        started_at,
        created_at,
        updated_at
      )
      VALUES (
        ${recordId},
        'PROCESSING',
        ${claimToken},
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (record_id) DO NOTHING
      RETURNING record_id
    `);
    if (inserted.rows.length > 0) return { status: 'CLAIMED', context, claimToken };

    const winner = await this.loadState(recordId);
    return winner ? stateResult(winner) : { status: 'NOT_ELIGIBLE' };
  }

  async getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        provider,
        model,
        input_usd_per_million,
        output_usd_per_million,
        audio_usd_per_million,
        image_usd_per_million,
        usd_twd_rate
      FROM worklog_ai_runtime_config
      WHERE id = 1
      LIMIT 1
    `);
    const row = result.rows[0] as RuntimeConfigRow | undefined;
    if (!row) return null;
    return {
      provider: requiredDbText(row.provider, 'provider'),
      model: requiredDbText(row.model, 'model'),
      inputUsdPerMillion: nonNegativeNumeric(row.input_usd_per_million, 'input_usd_per_million'),
      outputUsdPerMillion: nonNegativeNumeric(row.output_usd_per_million, 'output_usd_per_million'),
      audioUsdPerMillion: nullableNonNegativeNumeric(row.audio_usd_per_million, 'audio_usd_per_million'),
      imageUsdPerMillion: nullableNonNegativeNumeric(row.image_usd_per_million, 'image_usd_per_million'),
      usdTwdRate: nullableNonNegativeNumeric(row.usd_twd_rate, 'usd_twd_rate'),
    };
  }

  async setPending(
    recordId: number,
    claimToken: string,
    errorCode: string,
    detail?: string | null,
  ): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'PENDING',
        reservation_token = NULL,
        last_error_code = ${trimTo(errorCode, 128)},
        last_error_detail = ${nullableTrimTo(detail, 2000)},
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status = 'PROCESSING'
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'normalization claim could not be deferred');
  }

  async saveProviderResult(input: {
    recordId: number;
    claimToken: string;
    reservationToken: string;
    output: WorklogTextNormalizationOutput;
    usage: WorklogAiUsageCommit;
    providerResponseId: string | null;
    latencyMs: number;
  }): Promise<void> {
    const resultJson = JSON.stringify(input.output);
    const usageJson = JSON.stringify(input.usage);
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'PROVIDER_SUCCEEDED',
        reservation_token = ${input.reservationToken},
        result_json = ${resultJson}::jsonb,
        usage_commit_json = ${usageJson}::jsonb,
        provider_response_id = ${input.providerResponseId},
        latency_ms = ${input.latencyMs},
        provider_succeeded_at = NOW(),
        last_error_code = NULL,
        last_error_detail = NULL,
        updated_at = NOW()
      WHERE record_id = ${input.recordId}
        AND claim_token = ${input.claimToken}
        AND status = 'PROCESSING'
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'provider result could not be persisted');
  }

  async getReservationStatus(
    reservationToken: string,
  ): Promise<'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null> {
    const result = await this.db.execute(sql`
      SELECT status
      FROM worklog_ai_point_reservations
      WHERE token = ${reservationToken}
      LIMIT 1
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    return status === 'RESERVED' || status === 'COMMITTED' || status === 'RELEASED' || status === 'EXPIRED'
      ? status
      : null;
  }

  async markUsageCommitted(recordId: number, claimToken: string): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'USAGE_COMMITTED',
        usage_committed_at = COALESCE(usage_committed_at, NOW()),
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status IN ('PROVIDER_SUCCEEDED', 'USAGE_COMMITTED')
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'normalization usage state could not be committed');
  }

  async applyResult(input: {
    recordId: number;
    claimToken: string;
    output: WorklogTextNormalizationOutput;
  }): Promise<WorklogTextApplyResult> {
    const record = await this.loadTargetRecord(input.recordId);
    if (!record || record.status !== 'ACTIVE' || record.version !== 1) {
      await this.completeNormalization(
        input.recordId,
        input.claimToken,
        'AI_RESULT_SKIPPED_RECORD_CHANGED',
        'The Record was deleted or edited before AI title/time interpretation could be applied.',
      );
      return { status: 'SKIPPED_RECORD_CHANGED' };
    }

    if (record.entityId !== null) {
      await this.completeNormalization(input.recordId, input.claimToken);
      return { status: 'APPLIED', entityId: record.entityId, createdEntity: false };
    }

    const occurredAt = input.output.occurredAt
      ? validDate(input.output.occurredAt, 'occurredAt')
      : record.occurredAt;
    const title = input.output.title?.trim() || null;

    if (!title) {
      const confirmationId = await this.ensureConfirmation({
        record,
        claimToken: input.claimToken,
        type: 'RECORD_TITLE',
        proposedName: null,
        candidate: null,
        candidates: [],
        occurredAt,
        reason: 'AI_NO_CLEAR_TITLE',
      });
      return { status: 'PENDING_CONFIRMATION', confirmationId };
    }

    const exactCandidates = await this.findExactCandidates(record.sourceId, title);
    if (input.output.titleRequiresConfirmation || exactCandidates.length > 1) {
      const confirmationId = await this.ensureConfirmation({
        record,
        claimToken: input.claimToken,
        type: exactCandidates.length === 1 ? 'ALIAS_MATCH' : 'RECORD_TITLE',
        proposedName: title,
        candidate: exactCandidates.length === 1 ? exactCandidates[0] : null,
        candidates: exactCandidates,
        occurredAt,
        reason: input.output.titleRequiresConfirmation
          ? 'AI_TITLE_REQUIRES_CONFIRMATION'
          : 'MULTIPLE_EXACT_TITLE_MATCHES',
      });
      return { status: 'PENDING_CONFIRMATION', confirmationId };
    }

    if (exactCandidates.length === 1) {
      return this.applyEntity(
        record,
        input.claimToken,
        exactCandidates[0].entityId,
        occurredAt,
        false,
      );
    }

    const fuzzyCandidates = await this.findPotentialCandidates(record.sourceId, title);
    if (fuzzyCandidates.length > 0) {
      const confirmationId = await this.ensureConfirmation({
        record,
        claimToken: input.claimToken,
        type: fuzzyCandidates.length === 1 ? 'ALIAS_MATCH' : 'RECORD_TITLE',
        proposedName: title,
        candidate: fuzzyCandidates.length === 1 ? fuzzyCandidates[0] : null,
        candidates: fuzzyCandidates,
        occurredAt,
        reason: 'POSSIBLE_EXISTING_TITLE',
      });
      return { status: 'PENDING_CONFIRMATION', confirmationId };
    }

    const entityId = await this.createEntity(record.sourceId, title);
    return this.applyEntity(record, input.claimToken, entityId, occurredAt, true);
  }

  async fail(
    recordId: number,
    claimToken: string,
    errorCode: string,
    detail?: string | null,
  ): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'FAILED',
        last_error_code = ${trimTo(errorCode, 128)},
        last_error_detail = ${nullableTrimTo(detail, 2000)},
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status IN ('PROCESSING', 'PROVIDER_SUCCEEDED')
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'normalization failure state could not be persisted');
  }

  private async applyEntity(
    record: {
      id: number;
      sourceId: number;
      authorUserId: number;
      entityId: number | null;
      rawText: string;
      occurredAt: Date;
      status: 'ACTIVE' | 'DELETED';
      version: number;
    },
    claimToken: string,
    entityId: number,
    occurredAt: Date,
    createdEntity: boolean,
  ): Promise<WorklogTextApplyResult> {
    const updated = await this.db.execute(sql`
      UPDATE worklog_records AS record
      SET
        entity_id = ${entityId},
        occurred_at = ${occurredAt},
        updated_at = NOW()
      WHERE record.id = ${record.id}
        AND record.source_id = ${record.sourceId}
        AND record.status = 'ACTIVE'
        AND record.version = 1
        AND record.entity_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM worklog_entities AS entity
          WHERE entity.id = ${entityId}
            AND entity.source_id = record.source_id
            AND entity.status = 'ACTIVE'
        )
      RETURNING record.entity_id::text AS entity_id
    `);

    if (updated.rows.length === 0) {
      const current = await this.loadTargetRecord(record.id);
      if (current?.entityId !== null && current?.entityId !== undefined) {
        await this.completeNormalization(record.id, claimToken);
        return { status: 'APPLIED', entityId: current.entityId, createdEntity: false };
      }
      await this.completeNormalization(
        record.id,
        claimToken,
        'AI_RESULT_SKIPPED_RECORD_CHANGED',
        'The Record changed before the resolved title could be applied.',
      );
      return { status: 'SKIPPED_RECORD_CHANGED' };
    }

    await this.completeNormalization(record.id, claimToken);
    return { status: 'APPLIED', entityId, createdEntity };
  }

  private async ensureConfirmation(input: {
    record: {
      id: number;
      sourceId: number;
      authorUserId: number;
      rawText: string;
      occurredAt: Date;
    };
    claimToken: string;
    type: 'ALIAS_MATCH' | 'RECORD_TITLE' | 'ENTITY_MATCH';
    proposedName: string | null;
    candidate: EntityCandidate | null;
    candidates: EntityCandidate[];
    occurredAt: Date;
    reason: string;
  }): Promise<number> {
    const existing = await this.db.execute(sql`
      SELECT id::text AS id
      FROM worklog_ai_confirmations
      WHERE record_id = ${input.record.id}
        AND requested_user_id = ${input.record.authorUserId}
        AND status = 'PENDING'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const existingId = optionalPositiveNumeric(
      (existing.rows[0] as { id?: string | number } | undefined)?.id,
      'confirmation id',
    );
    if (existingId !== null) {
      await this.completeNormalization(input.record.id, input.claimToken);
      return existingId;
    }

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
        source_id,
        record_id,
        requested_user_id,
        confirmation_type,
        candidate_entity_id,
        proposed_name,
        payload,
        status,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (
        ${input.record.sourceId},
        ${input.record.id},
        ${input.record.authorUserId},
        ${input.type},
        ${input.candidate?.entityId ?? null},
        ${input.proposedName},
        ${payload}::jsonb,
        'PENDING',
        NOW() + INTERVAL '7 days',
        NOW(),
        NOW()
      )
      RETURNING id::text AS id
    `);
    const confirmationId = positiveNumeric(
      (inserted.rows[0] as { id?: string | number } | undefined)?.id,
      'confirmation id',
    );
    await this.completeNormalization(input.record.id, input.claimToken);
    return confirmationId;
  }

  private async findExactCandidates(sourceId: number, title: string): Promise<EntityCandidate[]> {
    const result = await this.db.execute(sql`
      SELECT match.entity_id::text AS entity_id, match.name, match.matched_via
      FROM (
        SELECT entity.id AS entity_id, entity.name AS name, 'ENTITY'::text AS matched_via
        FROM worklog_entities AS entity
        WHERE entity.source_id = ${sourceId}
          AND entity.status = 'ACTIVE'
          AND LOWER(BTRIM(entity.name)) = LOWER(BTRIM(${title}))
        UNION ALL
        SELECT alias.entity_id, entity.name, 'ALIAS'::text AS matched_via
        FROM worklog_entity_aliases AS alias
        INNER JOIN worklog_entities AS entity
          ON entity.id = alias.entity_id
         AND entity.source_id = alias.source_id
         AND entity.status = 'ACTIVE'
        WHERE alias.source_id = ${sourceId}
          AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(${title}))
      ) AS match
      ORDER BY match.entity_id
    `);
    return dedupeCandidates(result.rows.map((row) => candidateRow(row)));
  }

  private async findPotentialCandidates(sourceId: number, title: string): Promise<EntityCandidate[]> {
    if (Array.from(title.trim()).length < 3) return [];
    const result = await this.db.execute(sql`
      SELECT DISTINCT
        entity.id::text AS entity_id,
        entity.name,
        'FUZZY'::text AS matched_via
      FROM worklog_entities AS entity
      LEFT JOIN worklog_entity_aliases AS alias
        ON alias.entity_id = entity.id
       AND alias.source_id = entity.source_id
      WHERE entity.source_id = ${sourceId}
        AND entity.status = 'ACTIVE'
        AND (
          POSITION(LOWER(${title}) IN LOWER(entity.name)) > 0
          OR POSITION(LOWER(entity.name) IN LOWER(${title})) > 0
          OR (
            alias.alias IS NOT NULL
            AND (
              POSITION(LOWER(${title}) IN LOWER(alias.alias)) > 0
              OR POSITION(LOWER(alias.alias) IN LOWER(${title})) > 0
            )
          )
        )
      ORDER BY entity.name
      LIMIT 5
    `);
    return result.rows.map((row) => candidateRow(row));
  }

  private async createEntity(sourceId: number, title: string): Promise<number> {
    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_entities (
        source_id,
        name,
        status,
        created_at,
        updated_at
      )
      VALUES (${sourceId}, ${trimTo(title, 255)}, 'ACTIVE', NOW(), NOW())
      ON CONFLICT (source_id, name)
      DO UPDATE SET updated_at = worklog_entities.updated_at
      RETURNING id::text AS id
    `);
    return positiveNumeric(
      (inserted.rows[0] as { id?: string | number } | undefined)?.id,
      'entity id',
    );
  }

  private async completeNormalization(
    recordId: number,
    claimToken: string,
    diagnosticCode?: string,
    diagnosticDetail?: string,
  ): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_record_ai_normalizations
      SET
        status = 'SUCCEEDED',
        completed_at = COALESCE(completed_at, NOW()),
        last_error_code = ${diagnosticCode ? trimTo(diagnosticCode, 128) : null},
        last_error_detail = ${diagnosticDetail ? trimTo(diagnosticDetail, 2000) : null},
        updated_at = NOW()
      WHERE record_id = ${recordId}
        AND claim_token = ${claimToken}
        AND status IN ('USAGE_COMMITTED', 'SUCCEEDED')
      RETURNING record_id
    `);
    requireMutation(result.rows.length, 'interpreted Record could not be completed');
  }

  private async loadState(recordId: number): Promise<NormalizationStateRow | null> {
    const result = await this.db.execute(sql`
      SELECT
        record_id::text AS record_id,
        status,
        claim_token,
        reservation_token,
        result_json,
        usage_commit_json
      FROM worklog_record_ai_normalizations
      WHERE record_id = ${recordId}
      LIMIT 1
    `);
    return (result.rows[0] as NormalizationStateRow | undefined) ?? null;
  }

  private async loadContext(recordId: number): Promise<WorklogTextNormalizationContext | null> {
    const result = await this.db.execute(sql`
      SELECT
        record.id::text AS record_id,
        source.workspace_id::text AS workspace_id,
        record.source_id::text AS source_id,
        record.author_user_id::text AS actor_user_id,
        CASE
          WHEN source.type = 'GROUP' THEN responsibility.responsible_user_id::text
          WHEN source.type = 'PRIVATE' THEN source.private_user_id::text
          ELSE NULL
        END AS charged_user_id,
        record.raw_text,
        record.occurred_at
      FROM worklog_records AS record
      INNER JOIN worklog_sources AS source ON source.id = record.source_id
      LEFT JOIN worklog_source_ai_responsibility AS responsibility
        ON responsibility.source_id = source.id
      LEFT JOIN worklog_source_members AS responsible_member
        ON responsible_member.source_id = source.id
       AND responsible_member.user_id = responsibility.responsible_user_id
      WHERE record.id = ${recordId}
        AND record.input_type = 'TEXT'
        AND record.raw_text IS NOT NULL
        AND BTRIM(record.raw_text) <> ''
        AND record.author_user_id IS NOT NULL
        AND record.entity_id IS NULL
        AND record.status = 'ACTIVE'
        AND record.version = 1
        AND source.status = 'ACTIVE'
        AND (
          (
            source.type = 'GROUP'
            AND responsibility.responsible_user_id IS NOT NULL
            AND responsible_member.is_active = TRUE
          )
          OR (source.type = 'PRIVATE' AND source.private_user_id IS NOT NULL)
        )
      LIMIT 1
    `);
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    return {
      recordId: positiveNumeric(row.record_id, 'record_id'),
      workspaceId: positiveNumeric(row.workspace_id, 'workspace_id'),
      sourceId: positiveNumeric(row.source_id, 'source_id'),
      actorUserId: positiveNumeric(row.actor_user_id, 'actor_user_id'),
      chargedUserId: positiveNumeric(row.charged_user_id, 'charged_user_id'),
      rawText: requiredDbText(row.raw_text, 'raw_text'),
      occurredAt: validDate(row.occurred_at, 'occurred_at'),
    };
  }

  private async loadTargetRecord(recordId: number): Promise<{
    id: number;
    sourceId: number;
    authorUserId: number;
    entityId: number | null;
    rawText: string;
    occurredAt: Date;
    status: 'ACTIVE' | 'DELETED';
    version: number;
  } | null> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        source_id::text AS source_id,
        author_user_id::text AS author_user_id,
        entity_id::text AS entity_id,
        raw_text,
        occurred_at,
        status,
        version
      FROM worklog_records
      WHERE id = ${recordId}
      LIMIT 1
    `);
    const row = result.rows[0] as TargetRecordRow | undefined;
    if (!row || row.author_user_id === null) return null;
    if (row.status !== 'ACTIVE' && row.status !== 'DELETED') return null;
    return {
      id: positiveNumeric(row.id, 'record id'),
      sourceId: positiveNumeric(row.source_id, 'source id'),
      authorUserId: positiveNumeric(row.author_user_id, 'author user id'),
      entityId: optionalPositiveNumeric(row.entity_id, 'entity id'),
      rawText: requiredDbText(row.raw_text, 'raw text'),
      occurredAt: validDate(row.occurred_at, 'occurred at'),
      status: row.status,
      version: positiveNumeric(row.version, 'record version'),
    };
  }
}

function stateResult(row: NormalizationStateRow): WorklogTextNormalizationBeginResult {
  if (row.status === 'PROVIDER_SUCCEEDED' || row.status === 'USAGE_COMMITTED') {
    return { status: row.status, payload: persistedPayload(row) };
  }
  return { status: row.status };
}

function persistedPayload(row: NormalizationStateRow): WorklogPersistedNormalizationPayload {
  if (!row.reservation_token) throw new Error('normalization state is missing reservation token');
  return {
    recordId: positiveNumeric(row.record_id, 'record_id'),
    claimToken: requiredDbText(row.claim_token, 'claim_token'),
    reservationToken: requiredDbText(row.reservation_token, 'reservation_token'),
    output: normalizeWorklogTextOutput(row.result_json),
    usage: parseUsageCommit(row.usage_commit_json),
  };
}

function parseUsageCommit(value: unknown): WorklogAiUsageCommit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('normalization state is missing AI usage snapshot');
  }
  const row = value as Record<string, unknown>;
  return {
    actualUnits: nonNegativeIntegerValue(row.actualUnits, 'actualUnits'),
    workspaceId: optionalPositiveIntegerValue(row.workspaceId, 'workspaceId'),
    recordId: optionalPositiveIntegerValue(row.recordId, 'recordId'),
    operation: optionalTextValue(row.operation, 'operation', 64),
    provider: requiredUnknownText(row.provider, 'provider'),
    model: requiredUnknownText(row.model, 'model'),
    inputTokens: nonNegativeIntegerValue(row.inputTokens, 'inputTokens'),
    outputTokens: nonNegativeIntegerValue(row.outputTokens, 'outputTokens'),
    audioInputUnits: nonNegativeIntegerValue(row.audioInputUnits ?? 0, 'audioInputUnits'),
    imageInputUnits: nonNegativeIntegerValue(row.imageInputUnits ?? 0, 'imageInputUnits'),
    inputUsdPerMillion: nonNegativeNumberValue(row.inputUsdPerMillion, 'inputUsdPerMillion'),
    outputUsdPerMillion: nonNegativeNumberValue(row.outputUsdPerMillion, 'outputUsdPerMillion'),
    audioUsdPerMillion: optionalNonNegativeNumberValue(row.audioUsdPerMillion, 'audioUsdPerMillion'),
    imageUsdPerMillion: optionalNonNegativeNumberValue(row.imageUsdPerMillion, 'imageUsdPerMillion'),
    usdTwdRate: optionalNonNegativeNumberValue(row.usdTwdRate, 'usdTwdRate'),
    providerCostUsd: nonNegativeNumberValue(row.providerCostUsd, 'providerCostUsd'),
    providerCostTwd: optionalNonNegativeNumberValue(row.providerCostTwd, 'providerCostTwd'),
  };
}

function candidateRow(value: unknown): EntityCandidate {
  const row = value as { entity_id?: unknown; name?: unknown; matched_via?: unknown };
  const matchedVia = row.matched_via;
  if (matchedVia !== 'ENTITY' && matchedVia !== 'ALIAS' && matchedVia !== 'FUZZY') {
    throw new Error('invalid title candidate match type');
  }
  return {
    entityId: positiveNumeric(row.entity_id, 'candidate entity id'),
    name: requiredUnknownText(row.name, 'candidate entity name'),
    matchedVia,
  };
}

function dedupeCandidates(values: EntityCandidate[]): EntityCandidate[] {
  const seen = new Set<number>();
  const result: EntityCandidate[] = [];
  for (const value of values) {
    if (seen.has(value.entityId)) continue;
    seen.add(value.entityId);
    result.push(value);
  }
  return result;
}

function requireMutation(count: number, message: string): void {
  if (count < 1) throw new Error(message);
}

function trimTo(value: string, max: number): string {
  const normalized = value.trim();
  return (normalized || 'UNKNOWN').slice(0, max);
}

function nullableTrimTo(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requiredDbText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function requiredUnknownText(value: unknown, label: string): string {
  return requiredDbText(value, label);
}

function optionalTextValue(value: unknown, label: string, max: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`invalid ${label}`);
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function positiveNumeric(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function optionalPositiveNumeric(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return positiveNumeric(value, label);
}

function nonNegativeNumeric(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function nullableNonNegativeNumeric(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return nonNegativeNumeric(value, label);
}

function validDate(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${label}`);
  return parsed;
}

function nonNegativeIntegerValue(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function optionalPositiveIntegerValue(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return positiveNumeric(value, label);
}

function nonNegativeNumberValue(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function optionalNonNegativeNumberValue(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeNumberValue(value, label);
}
