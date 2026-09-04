import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  normalizeWorklogLineRecordEditOutput,
  type WorklogLineRecordEditApplyResult,
  type WorklogLineRecordEditBeginResult,
  type WorklogLineRecordEditContext,
  type WorklogLineRecordEditOutput,
  type WorklogLineRecordEditRepository,
  type WorklogPersistedLineEditPayload,
} from './line-record-edit';
import type { WorklogAiRuntimeConfigSnapshot } from './text-normalization';
import type { WorklogAiUsageCommit } from './subscription';

type EditStatus =
  | 'PROCESSING'
  | 'PROVIDER_SUCCEEDED'
  | 'USAGE_COMMITTED'
  | 'PENDING_CONFIRMATION'
  | 'SUCCEEDED'
  | 'RECORD_CHANGED'
  | 'FAILED';

type EditStateRow = {
  id: string | number;
  source_id: string | number;
  record_id: string | number;
  actor_user_id: string | number;
  charged_user_id: string | number;
  line_command_message_id: string;
  quoted_line_message_id: string;
  command_timestamp: Date | string;
  instruction: string;
  expected_record_version: string | number;
  status: EditStatus;
  claim_token: string;
  reservation_token: string | null;
  result_json: unknown;
  usage_commit_json: unknown;
  confirmation_id: string | number | null;
  applied_record_version: string | number | null;
  applied_entity_id: string | number | null;
  last_error_code: string | null;
};

type TargetRow = {
  workspace_id: string | number;
  source_id: string | number;
  record_id: string | number;
  raw_text: string;
  occurred_at: Date | string;
  entity_id: string | number | null;
  title: string | null;
  version: string | number;
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

type Candidate = { entityId: number; name: string; matchedVia: 'ENTITY' | 'ALIAS' | 'FUZZY' };

type CurrentRecord = {
  id: number;
  sourceId: number;
  entityId: number | null;
  rawText: string;
  occurredAt: Date;
  status: 'ACTIVE' | 'DELETED';
  version: number;
  actorUserId: number;
  expectedVersion: number;
};

export class DrizzleWorklogLineRecordEditRepository implements WorklogLineRecordEditRepository {
  constructor(private readonly db: Database) {}

  async begin(input: {
    sourceId: number;
    recordId: number;
    actorUserId: number;
    chargedUserId: number;
    lineCommandMessageId: string;
    quotedLineMessageId: string;
    commandTimestamp: Date;
    instruction: string;
    expectedRecordVersion: number;
    claimToken: string;
  }): Promise<WorklogLineRecordEditBeginResult> {
    // An abandoned PROCESSING row is deliberately terminal. It is impossible to know
    // whether the provider returned before a Worker died, so automatic replay could
    // double-charge and apply a second interpretation.
    await this.db.execute(sql`
      UPDATE worklog_line_ai_edits
      SET status = 'FAILED',
          last_error_code = 'AI_EDIT_PROCESSING_STALE_UNCERTAIN',
          last_error_detail = 'Provider execution or durable provider-result persistence became uncertain; automatic replay is disabled.',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE line_command_message_id = ${input.lineCommandMessageId}
        AND status = 'PROCESSING'
        AND updated_at < NOW() - INTERVAL '15 minutes'
    `);

    const existing = await this.loadStateByCommand(input.lineCommandMessageId);
    if (existing) {
      if (!sameIdentity(existing, input)) return { status: 'IDEMPOTENCY_CONFLICT' };
      return stateResult(existing);
    }

    const target = await this.loadEligibleTarget(input.sourceId, input.recordId, input.expectedRecordVersion);
    if (!target) return { status: 'NOT_ELIGIBLE' };

    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_line_ai_edits (
        source_id, record_id, actor_user_id, charged_user_id,
        line_command_message_id, quoted_line_message_id, command_timestamp,
        instruction, expected_record_version, status, claim_token,
        started_at, created_at, updated_at
      )
      VALUES (
        ${input.sourceId}, ${input.recordId}, ${input.actorUserId}, ${input.chargedUserId},
        ${input.lineCommandMessageId}, ${input.quotedLineMessageId}, ${input.commandTimestamp},
        ${input.instruction}, ${input.expectedRecordVersion}, 'PROCESSING', ${input.claimToken},
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (line_command_message_id) DO NOTHING
      RETURNING id::text AS id
    `);

    const id = (inserted.rows[0] as { id?: string } | undefined)?.id;
    if (id) {
      return {
        status: 'CLAIMED',
        claimToken: input.claimToken,
        context: contextFromTarget(positiveNumber(id, 'edit id'), target, input),
      };
    }

    const winner = await this.loadStateByCommand(input.lineCommandMessageId);
    if (!winner) return { status: 'NOT_ELIGIBLE' };
    if (!sameIdentity(winner, input)) return { status: 'IDEMPOTENCY_CONFLICT' };
    return stateResult(winner);
  }

  async getRuntimeConfig(): Promise<WorklogAiRuntimeConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT provider, model, input_usd_per_million, output_usd_per_million,
             audio_usd_per_million, image_usd_per_million, usd_twd_rate
      FROM worklog_ai_runtime_config
      WHERE id = 1
      LIMIT 1
    `);
    const row = result.rows[0] as RuntimeConfigRow | undefined;
    if (!row) return null;
    return {
      provider: requiredText(row.provider, 'provider'),
      model: requiredText(row.model, 'model'),
      inputUsdPerMillion: nonNegativeNumeric(row.input_usd_per_million, 'input price'),
      outputUsdPerMillion: positiveNumeric(row.output_usd_per_million, 'output price'),
      audioUsdPerMillion: nullableNonNegativeNumeric(row.audio_usd_per_million, 'audio price'),
      imageUsdPerMillion: nullableNonNegativeNumeric(row.image_usd_per_million, 'image price'),
      usdTwdRate: nullableNonNegativeNumeric(row.usd_twd_rate, 'USD/TWD rate'),
    };
  }

  async saveProviderResult(input: {
    editId: number;
    claimToken: string;
    reservationToken: string;
    output: WorklogLineRecordEditOutput;
    usage: WorklogAiUsageCommit;
    providerResponseId: string | null;
    latencyMs: number;
  }): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_line_ai_edits
      SET status = 'PROVIDER_SUCCEEDED',
          reservation_token = ${input.reservationToken},
          result_json = ${JSON.stringify(input.output)}::jsonb,
          usage_commit_json = ${JSON.stringify(input.usage)}::jsonb,
          provider_response_id = ${input.providerResponseId},
          latency_ms = ${input.latencyMs},
          provider_succeeded_at = NOW(),
          last_error_code = NULL,
          last_error_detail = NULL,
          updated_at = NOW()
      WHERE id = ${input.editId}
        AND claim_token = ${input.claimToken}
        AND status = 'PROCESSING'
      RETURNING id
    `);
    requireMutation(result.rows.length, 'LINE AI edit provider result could not be persisted');
  }

  async getReservationStatus(
    reservationToken: string,
  ): Promise<'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | null> {
    const result = await this.db.execute(sql`
      SELECT status FROM worklog_ai_point_reservations WHERE token = ${reservationToken} LIMIT 1
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    return status === 'RESERVED' || status === 'COMMITTED' || status === 'RELEASED' || status === 'EXPIRED'
      ? status
      : null;
  }

  async markUsageCommitted(editId: number, claimToken: string): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_line_ai_edits
      SET status = 'USAGE_COMMITTED',
          usage_committed_at = COALESCE(usage_committed_at, NOW()),
          updated_at = NOW()
      WHERE id = ${editId}
        AND claim_token = ${claimToken}
        AND status IN ('PROVIDER_SUCCEEDED', 'USAGE_COMMITTED')
      RETURNING id
    `);
    requireMutation(result.rows.length, 'LINE AI edit usage state could not be committed');
  }

  async applyResult(input: {
    editId: number;
    claimToken: string;
    output: WorklogLineRecordEditOutput;
  }): Promise<WorklogLineRecordEditApplyResult> {
    const edit = await this.loadStateById(input.editId);
    if (!edit || edit.claim_token !== input.claimToken || edit.status !== 'USAGE_COMMITTED') {
      const terminal = edit ? stateResult(edit) : null;
      if (terminal?.status === 'SUCCEEDED') {
        return { status: 'APPLIED', recordVersion: terminal.recordVersion, entityId: terminal.entityId };
      }
      if (terminal?.status === 'PENDING_CONFIRMATION') return terminal;
      return { status: 'RECORD_CHANGED' };
    }

    const record = await this.loadCurrentRecord(edit);
    if (!record || record.status !== 'ACTIVE' || record.version !== record.expectedVersion) {
      await this.markRecordChanged(input.editId, input.claimToken);
      return { status: 'RECORD_CHANGED' };
    }

    const output = normalizeWorklogLineRecordEditOutput(input.output);
    const nextRawText = output.rawText;
    const nextOccurredAt = output.occurredAt ? validDate(output.occurredAt, 'occurredAt') : record.occurredAt;
    const requestedTitle = output.title?.trim() || null;

    let targetEntityId = record.entityId;
    let createdEntityId: number | null = null;
    if (requestedTitle) {
      const exact = await this.findExactCandidates(record.sourceId, requestedTitle);
      if (output.titleRequiresConfirmation || exact.length > 1) {
        return this.ensureEditConfirmation(edit, record, output, nextOccurredAt, requestedTitle, exact,
          output.titleRequiresConfirmation ? 'AI_EDIT_TITLE_REQUIRES_CONFIRMATION' : 'MULTIPLE_EXACT_TITLE_MATCHES');
      }
      if (exact.length === 1) {
        targetEntityId = exact[0].entityId;
      } else {
        const fuzzy = await this.findPotentialCandidates(record.sourceId, requestedTitle);
        if (fuzzy.length > 0) {
          return this.ensureEditConfirmation(edit, record, output, nextOccurredAt, requestedTitle, fuzzy, 'POSSIBLE_EXISTING_TITLE');
        }
        createdEntityId = await this.createEntity(record.sourceId, requestedTitle);
        targetEntityId = createdEntityId;
      }
    } else if (record.entityId === null) {
      return this.ensureEditConfirmation(edit, record, output, nextOccurredAt, null, [], 'AI_EDIT_RECORD_HAS_NO_TITLE');
    }

    if (!targetEntityId) {
      await this.markRecordChanged(input.editId, input.claimToken);
      return { status: 'RECORD_CHANGED' };
    }

    if (
      nextRawText === record.rawText &&
      nextOccurredAt.getTime() === record.occurredAt.getTime() &&
      targetEntityId === record.entityId
    ) {
      const completed = await this.db.execute(sql`
        UPDATE worklog_line_ai_edits
        SET status = 'SUCCEEDED',
            applied_record_version = ${record.version},
            applied_entity_id = ${targetEntityId},
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${input.editId}
          AND claim_token = ${input.claimToken}
          AND status = 'USAGE_COMMITTED'
        RETURNING applied_record_version
      `);
      if (completed.rows.length === 0) return { status: 'RECORD_CHANGED' };
      if (createdEntityId) await this.deleteUnusedEntity(createdEntityId);
      return { status: 'APPLIED', recordVersion: record.version, entityId: targetEntityId };
    }

    const nextVersion = record.version + 1;
    const mutated = await this.db.execute(sql`
      WITH updated_record AS (
        UPDATE worklog_records record
        SET raw_text = ${nextRawText},
            occurred_at = ${nextOccurredAt},
            entity_id = ${targetEntityId},
            version = ${nextVersion},
            updated_at = NOW()
        WHERE record.id = ${record.id}
          AND record.source_id = ${record.sourceId}
          AND record.status = 'ACTIVE'
          AND record.version = ${record.version}
          AND EXISTS (
            SELECT 1 FROM worklog_entities entity
            WHERE entity.id = ${targetEntityId}
              AND entity.source_id = record.source_id
              AND entity.status = 'ACTIVE'
          )
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
          ${record.id}, ${nextVersion}, ${record.actorUserId}, 'LINE_AI_EDIT',
          ${record.rawText}, ${nextRawText},
          ${record.occurredAt}, ${nextOccurredAt},
          ${record.entityId}, ${targetEntityId},
          'ACTIVE', 'ACTIVE', NOW()
        FROM updated_record
        RETURNING id
      ), finished AS (
        UPDATE worklog_line_ai_edits edit
        SET status = 'SUCCEEDED',
            applied_record_version = ${nextVersion},
            applied_entity_id = ${targetEntityId},
            completed_at = NOW(),
            updated_at = NOW()
        FROM updated_record, revision
        WHERE edit.id = ${input.editId}
          AND edit.claim_token = ${input.claimToken}
          AND edit.status = 'USAGE_COMMITTED'
        RETURNING edit.applied_record_version
      )
      SELECT applied_record_version FROM finished LIMIT 1
    `);

    const appliedVersion = (mutated.rows[0] as { applied_record_version?: number | string } | undefined)?.applied_record_version;
    if (!appliedVersion) {
      if (createdEntityId) await this.deleteUnusedEntity(createdEntityId);
      await this.markRecordChanged(input.editId, input.claimToken);
      return { status: 'RECORD_CHANGED' };
    }
    return { status: 'APPLIED', recordVersion: positiveNumber(appliedVersion, 'record version'), entityId: targetEntityId };
  }

  async fail(editId: number, claimToken: string, errorCode: string, detail?: string | null): Promise<void> {
    const result = await this.db.execute(sql`
      UPDATE worklog_line_ai_edits
      SET status = 'FAILED',
          last_error_code = ${trimTo(errorCode, 128)},
          last_error_detail = ${nullableTrimTo(detail, 2_000)},
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE id = ${editId}
        AND claim_token = ${claimToken}
        AND status IN ('PROCESSING', 'PROVIDER_SUCCEEDED')
      RETURNING id
    `);
    if (result.rows.length === 0) {
      const state = await this.loadStateById(editId);
      if (!state || state.claim_token !== claimToken || state.status !== 'FAILED') {
        throw new Error('LINE AI edit failure state could not be persisted');
      }
    }
  }

  private async ensureEditConfirmation(
    edit: EditStateRow,
    record: CurrentRecord,
    output: WorklogLineRecordEditOutput,
    occurredAt: Date,
    proposedName: string | null,
    candidates: Candidate[],
    reason: string,
  ): Promise<WorklogLineRecordEditApplyResult> {
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const payload = {
      operation: 'LINE_AI_EDIT',
      lineEditId: positiveNumber(edit.id, 'edit id'),
      reason,
      recordVersion: record.version,
      occurredAt: occurredAt.toISOString(),
      proposedRawText: output.rawText,
      previousEntityId: record.entityId,
      candidates,
    };
    const result = await this.db.execute(sql`
      WITH eligible AS (
        SELECT record.id
        FROM worklog_records record
        WHERE record.id = ${record.id}
          AND record.source_id = ${record.sourceId}
          AND record.status = 'ACTIVE'
          AND record.version = ${record.version}
      ), confirmation AS (
        INSERT INTO worklog_ai_confirmations (
          source_id, record_id, requested_user_id, confirmation_type,
          candidate_entity_id, proposed_name, payload, status,
          expires_at, created_at, updated_at
        )
        SELECT
          ${record.sourceId}, ${record.id}, ${record.actorUserId},
          ${candidate ? 'ALIAS_MATCH' : 'RECORD_TITLE'},
          ${candidate?.entityId ?? null}, ${proposedName}, ${JSON.stringify(payload)}::jsonb,
          'PENDING', NOW() + INTERVAL '7 days', NOW(), NOW()
        FROM eligible
        RETURNING id
      ), marked AS (
        UPDATE worklog_line_ai_edits edit
        SET status = 'PENDING_CONFIRMATION',
            confirmation_id = confirmation.id,
            completed_at = NOW(),
            updated_at = NOW()
        FROM confirmation
        WHERE edit.id = ${positiveNumber(edit.id, 'edit id')}
          AND edit.claim_token = ${edit.claim_token}
          AND edit.status = 'USAGE_COMMITTED'
        RETURNING confirmation.id::text AS confirmation_id
      )
      SELECT confirmation_id FROM marked LIMIT 1
    `);
    const confirmationId = (result.rows[0] as { confirmation_id?: string } | undefined)?.confirmation_id;
    if (!confirmationId) {
      await this.markRecordChanged(positiveNumber(edit.id, 'edit id'), edit.claim_token);
      return { status: 'RECORD_CHANGED' };
    }
    return { status: 'PENDING_CONFIRMATION', confirmationId: positiveNumber(confirmationId, 'confirmation id') };
  }

  private async markRecordChanged(editId: number, claimToken: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE worklog_line_ai_edits
      SET status = 'RECORD_CHANGED',
          last_error_code = 'AI_EDIT_SKIPPED_RECORD_CHANGED',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${editId}
        AND claim_token = ${claimToken}
        AND status = 'USAGE_COMMITTED'
    `);
  }

  private async loadStateByCommand(lineCommandMessageId: string): Promise<EditStateRow | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, source_id::text AS source_id, record_id::text AS record_id,
             actor_user_id::text AS actor_user_id, charged_user_id::text AS charged_user_id,
             line_command_message_id, quoted_line_message_id, command_timestamp, instruction,
             expected_record_version, status, claim_token, reservation_token,
             result_json, usage_commit_json, confirmation_id::text AS confirmation_id,
             applied_record_version, applied_entity_id::text AS applied_entity_id, last_error_code
      FROM worklog_line_ai_edits
      WHERE line_command_message_id = ${lineCommandMessageId}
      LIMIT 1
    `);
    return (result.rows[0] as EditStateRow | undefined) ?? null;
  }

  private async loadStateById(editId: number): Promise<EditStateRow | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id, source_id::text AS source_id, record_id::text AS record_id,
             actor_user_id::text AS actor_user_id, charged_user_id::text AS charged_user_id,
             line_command_message_id, quoted_line_message_id, command_timestamp, instruction,
             expected_record_version, status, claim_token, reservation_token,
             result_json, usage_commit_json, confirmation_id::text AS confirmation_id,
             applied_record_version, applied_entity_id::text AS applied_entity_id, last_error_code
      FROM worklog_line_ai_edits
      WHERE id = ${editId}
      LIMIT 1
    `);
    return (result.rows[0] as EditStateRow | undefined) ?? null;
  }

  private async loadEligibleTarget(sourceId: number, recordId: number, expectedVersion: number): Promise<TargetRow | null> {
    const result = await this.db.execute(sql`
      SELECT source.workspace_id::text AS workspace_id,
             record.source_id::text AS source_id,
             record.id::text AS record_id,
             record.raw_text,
             record.occurred_at,
             record.entity_id::text AS entity_id,
             entity.name AS title,
             record.version
      FROM worklog_records record
      INNER JOIN worklog_sources source
        ON source.id = record.source_id AND source.status = 'ACTIVE'
      LEFT JOIN worklog_entities entity
        ON entity.id = record.entity_id AND entity.source_id = record.source_id AND entity.status = 'ACTIVE'
      WHERE record.id = ${recordId}
        AND record.source_id = ${sourceId}
        AND record.status = 'ACTIVE'
        AND record.version = ${expectedVersion}
      LIMIT 1
    `);
    return (result.rows[0] as TargetRow | undefined) ?? null;
  }

  private async loadCurrentRecord(edit: EditStateRow): Promise<CurrentRecord | null> {
    const result = await this.db.execute(sql`
      SELECT record.id::text AS id, record.source_id::text AS source_id,
             record.entity_id::text AS entity_id, record.raw_text,
             record.occurred_at, record.status, record.version
      FROM worklog_records record
      WHERE record.id = ${positiveNumber(edit.record_id, 'record id')}
        AND record.source_id = ${positiveNumber(edit.source_id, 'source id')}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: positiveNumber(row.id, 'record id'),
      sourceId: positiveNumber(row.source_id, 'source id'),
      entityId: optionalPositiveNumber(row.entity_id, 'entity id'),
      rawText: requiredText(row.raw_text, 'raw text'),
      occurredAt: validDate(row.occurred_at, 'occurred at'),
      status: row.status === 'DELETED' ? 'DELETED' : 'ACTIVE',
      version: positiveNumber(row.version, 'record version'),
      actorUserId: positiveNumber(edit.actor_user_id, 'actor user id'),
      expectedVersion: positiveNumber(edit.expected_record_version, 'expected record version'),
    };
  }

  private async findExactCandidates(sourceId: number, title: string): Promise<Candidate[]> {
    const result = await this.db.execute(sql`
      SELECT candidate.entity_id::text AS entity_id, candidate.name, candidate.matched_via
      FROM (
        SELECT entity.id AS entity_id, entity.name, 'ENTITY'::text AS matched_via
        FROM worklog_entities entity
        WHERE entity.source_id = ${sourceId}
          AND entity.status = 'ACTIVE'
          AND LOWER(BTRIM(entity.name)) = LOWER(BTRIM(${title}))
        UNION ALL
        SELECT entity.id AS entity_id, entity.name, 'ALIAS'::text AS matched_via
        FROM worklog_entity_aliases alias
        INNER JOIN worklog_entities entity
          ON entity.id = alias.entity_id AND entity.source_id = alias.source_id AND entity.status = 'ACTIVE'
        WHERE alias.source_id = ${sourceId}
          AND LOWER(BTRIM(alias.alias)) = LOWER(BTRIM(${title}))
      ) candidate
      ORDER BY CASE WHEN candidate.matched_via = 'ENTITY' THEN 0 ELSE 1 END, candidate.entity_id
      LIMIT 3
    `);
    return uniqueCandidates(result.rows as Array<Record<string, unknown>>);
  }

  private async findPotentialCandidates(sourceId: number, title: string): Promise<Candidate[]> {
    const needle = `%${escapeLike(title.trim())}%`;
    const result = await this.db.execute(sql`
      SELECT candidate.entity_id::text AS entity_id, candidate.name, 'FUZZY'::text AS matched_via
      FROM (
        SELECT entity.id AS entity_id, entity.name
        FROM worklog_entities entity
        WHERE entity.source_id = ${sourceId}
          AND entity.status = 'ACTIVE'
          AND (entity.name ILIKE ${needle} ESCAPE '\\' OR ${title} ILIKE ('%' || entity.name || '%'))
        UNION
        SELECT entity.id AS entity_id, entity.name
        FROM worklog_entity_aliases alias
        INNER JOIN worklog_entities entity
          ON entity.id = alias.entity_id AND entity.source_id = alias.source_id AND entity.status = 'ACTIVE'
        WHERE alias.source_id = ${sourceId}
          AND (alias.alias ILIKE ${needle} ESCAPE '\\' OR ${title} ILIKE ('%' || alias.alias || '%'))
      ) candidate
      ORDER BY candidate.entity_id
      LIMIT 3
    `);
    return uniqueCandidates(result.rows as Array<Record<string, unknown>>);
  }

  private async createEntity(sourceId: number, title: string): Promise<number> {
    const inserted = await this.db.execute(sql`
      INSERT INTO worklog_entities (source_id, name, status, created_at, updated_at)
      VALUES (${sourceId}, ${title}, 'ACTIVE', NOW(), NOW())
      ON CONFLICT (source_id, name) DO NOTHING
      RETURNING id::text AS id
    `);
    const insertedId = (inserted.rows[0] as { id?: string } | undefined)?.id;
    if (insertedId) return positiveNumber(insertedId, 'entity id');

    const existing = await this.db.execute(sql`
      SELECT id::text AS id FROM worklog_entities
      WHERE source_id = ${sourceId}
        AND status = 'ACTIVE'
        AND LOWER(BTRIM(name)) = LOWER(BTRIM(${title}))
      LIMIT 1
    `);
    const id = (existing.rows[0] as { id?: string } | undefined)?.id;
    if (!id) throw new Error('LINE AI edit title could not be created or resolved');
    return positiveNumber(id, 'entity id');
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

function stateResult(row: EditStateRow): WorklogLineRecordEditBeginResult {
  if (row.status === 'PROCESSING') return { status: 'PROCESSING' };
  if (row.status === 'PENDING_CONFIRMATION') {
    const confirmationId = optionalPositiveNumber(row.confirmation_id, 'confirmation id');
    return confirmationId ? { status: 'PENDING_CONFIRMATION', confirmationId } : { status: 'FAILED', reason: 'AI_EDIT_CONFIRMATION_STATE_INVALID' };
  }
  if (row.status === 'SUCCEEDED') {
    const recordVersion = optionalPositiveNumber(row.applied_record_version, 'applied record version');
    const entityId = optionalPositiveNumber(row.applied_entity_id, 'applied entity id');
    return recordVersion && entityId
      ? { status: 'SUCCEEDED', recordVersion, entityId }
      : { status: 'FAILED', reason: 'AI_EDIT_APPLY_STATE_INVALID' };
  }
  if (row.status === 'RECORD_CHANGED') return { status: 'RECORD_CHANGED' };
  if (row.status === 'FAILED') return { status: 'FAILED', reason: row.last_error_code?.trim() || 'PREVIOUS_PROVIDER_ATTEMPT_FAILED' };
  if (row.status === 'PROVIDER_SUCCEEDED' || row.status === 'USAGE_COMMITTED') {
    const payload = persistedPayload(row);
    return row.status === 'PROVIDER_SUCCEEDED'
      ? { status: 'PROVIDER_SUCCEEDED', payload }
      : { status: 'USAGE_COMMITTED', payload };
  }
  return { status: 'FAILED', reason: 'AI_EDIT_STATE_INVALID' };
}

function persistedPayload(row: EditStateRow): WorklogPersistedLineEditPayload {
  if (!row.reservation_token) throw new Error('LINE AI edit durable state is missing reservation token');
  if (!row.result_json || !row.usage_commit_json) throw new Error('LINE AI edit durable state is missing provider payload');
  return {
    editId: positiveNumber(row.id, 'edit id'),
    claimToken: requiredText(row.claim_token, 'claim token'),
    reservationToken: requiredText(row.reservation_token, 'reservation token'),
    output: normalizeWorklogLineRecordEditOutput(row.result_json),
    usage: row.usage_commit_json as WorklogAiUsageCommit,
  };
}

function sameIdentity(row: EditStateRow, input: {
  sourceId: number;
  recordId: number;
  actorUserId: number;
  chargedUserId: number;
  lineCommandMessageId: string;
  quotedLineMessageId: string;
  commandTimestamp: Date;
  instruction: string;
  expectedRecordVersion: number;
}): boolean {
  // chargedUserId and expectedRecordVersion are execution-time derived facts. A LINE
  // webhook redelivery may arrive after the first edit changed the Record version or
  // after funding responsibility changed. The immutable LINE command identity must
  // still resume its already-durable state instead of becoming a false conflict.
  return positiveNumber(row.source_id, 'source id') === input.sourceId
    && positiveNumber(row.record_id, 'record id') === input.recordId
    && positiveNumber(row.actor_user_id, 'actor user id') === input.actorUserId
    && row.line_command_message_id === input.lineCommandMessageId
    && row.quoted_line_message_id === input.quotedLineMessageId
    && validDate(row.command_timestamp, 'command timestamp').getTime() === input.commandTimestamp.getTime()
    && row.instruction === input.instruction;
}

function contextFromTarget(
  editId: number,
  row: TargetRow,
  input: {
    sourceId: number;
    recordId: number;
    actorUserId: number;
    chargedUserId: number;
    instruction: string;
    commandTimestamp: Date;
    expectedRecordVersion: number;
  },
): WorklogLineRecordEditContext {
  return {
    editId,
    workspaceId: positiveNumber(row.workspace_id, 'workspace id'),
    sourceId: positiveNumber(row.source_id, 'source id'),
    recordId: positiveNumber(row.record_id, 'record id'),
    actorUserId: input.actorUserId,
    chargedUserId: input.chargedUserId,
    instruction: input.instruction,
    commandTimestamp: new Date(input.commandTimestamp.getTime()),
    expectedRecordVersion: input.expectedRecordVersion,
    currentRawText: requiredText(row.raw_text, 'raw text'),
    currentOccurredAt: validDate(row.occurred_at, 'occurred at'),
    currentEntityId: optionalPositiveNumber(row.entity_id, 'entity id'),
    currentTitle: optionalText(row.title),
  };
}

function uniqueCandidates(rows: Array<Record<string, unknown>>): Candidate[] {
  const result: Candidate[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const entityId = positiveNumber(row.entity_id, 'entity id');
    if (seen.has(entityId)) continue;
    const matchedVia = row.matched_via === 'ALIAS' ? 'ALIAS' : row.matched_via === 'FUZZY' ? 'FUZZY' : 'ENTITY';
    result.push({ entityId, name: requiredText(row.name, 'entity name'), matchedVia });
    seen.add(entityId);
  }
  return result;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function requireMutation(count: number, message: string): void {
  if (count <= 0) throw new Error(message);
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

function validDate(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value : String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${label}`);
  return new Date(date.getTime());
}

function numeric(value: string | number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${label}`);
  return parsed;
}

function nonNegativeNumeric(value: string | number, label: string): number {
  const parsed = numeric(value, label);
  if (parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function positiveNumeric(value: string | number, label: string): number {
  const parsed = numeric(value, label);
  if (parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function nullableNonNegativeNumeric(value: string | number | null, label: string): number | null {
  return value === null ? null : nonNegativeNumeric(value, label);
}

function trimTo(value: string, max: number): string {
  const normalized = value.trim();
  return (normalized || 'UNKNOWN').slice(0, max);
}

function nullableTrimTo(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}
