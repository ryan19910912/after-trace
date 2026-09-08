import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { WorklogRecordReadService } from './records';
import type {
  ManualRecordFilters,
  ManualRecordPage,
  ManualRecordRevisionView,
  ManualRecordRouteRepository,
  ManualRecordView,
} from './manual-record-routes';

export class DrizzleManualRecordRouteRepository implements ManualRecordRouteRepository {
  private readonly recordReads: WorklogRecordReadService;

  constructor(private readonly database: Database) {
    this.recordReads = new WorklogRecordReadService(new DrizzleWorklogRecordReadRepository(database));
  }

  surfaces(userId: number) {
    return this.recordReads.surfaces(userId);
  }

  async personalSourceId(userId: number): Promise<number | null> {
    const result = await this.database.execute(sql`
      SELECT source.id::text AS id
      FROM worklog_sources source
      WHERE source.type = 'PRIVATE'
        AND source.status = 'ACTIVE'
        AND source.private_user_id = ${userId}
      LIMIT 1
    `);
    return databaseId((result.rows[0] as { id?: string } | undefined)?.id);
  }

  async hasGroupAccess(userId: number, sourceId: number): Promise<boolean> {
    const result = await this.database.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM worklog_sources source
        INNER JOIN worklog_source_members member ON member.source_id = source.id
        WHERE source.id = ${sourceId}
          AND source.type = 'GROUP'
          AND source.status = 'ACTIVE'
          AND source.line_group_id IS NULL
          AND source.name IS NOT NULL
          AND length(btrim(source.name)) > 0
          AND member.user_id = ${userId}
          AND member.is_active = TRUE
      ) AS allowed
    `);
    return Boolean((result.rows[0] as { allowed?: boolean } | undefined)?.allowed);
  }

  async legacyEntity(sourceId: number, entityId: number): Promise<{ id: number; name: string } | null> {
    const result = await this.database.execute(sql`
      SELECT entity.id::text AS id, entity.name
      FROM worklog_entities entity
      WHERE entity.id = ${entityId}
        AND entity.source_id = ${sourceId}
        AND entity.status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; name?: string } | undefined;
    const id = databaseId(row?.id);
    return id && row?.name ? { id, name: row.name } : null;
  }

  async listRecords(input: {
    sourceId: number;
    status: 'ACTIVE' | 'DELETED';
    filters: ManualRecordFilters;
  }): Promise<ManualRecordPage> {
    const { sourceId, status, filters } = input;
    const result = await this.database.execute(sql`
      SELECT record.id::text AS id,
             record.source_id::text AS source_id,
             record.entity_id::text AS entity_id,
             record.title,
             record.author_user_id::text AS author_user_id,
             author.display_name AS author_display_name,
             record.input_type,
             record.raw_text,
             record.capture_context,
             record.occurred_at,
             record.status,
             record.version,
             record.deleted_at,
             record.created_at,
             record.updated_at
      FROM worklog_records record
      LEFT JOIN worklog_users author ON author.id = record.author_user_id
      WHERE record.source_id = ${sourceId}
        AND record.status = ${status}
        AND (
          ${filters.query}::text IS NULL
          OR record.raw_text ILIKE '%' || ${filters.query} || '%'
          OR COALESCE(record.title, '') ILIKE '%' || ${filters.query} || '%'
          OR COALESCE(record.search_terms::text, '') ILIKE '%' || ${filters.query} || '%'
        )
        AND (
          ${filters.from}::timestamptz IS NULL
          OR COALESCE(record.occurred_at, record.created_at) >= ${filters.from}
        )
        AND (
          ${filters.to}::timestamptz IS NULL
          OR COALESCE(record.occurred_at, record.created_at) < ${filters.to}
        )
      ORDER BY COALESCE(record.occurred_at, record.created_at) DESC, record.id DESC
      LIMIT ${filters.limit + 1}
      OFFSET ${filters.offset}
    `);
    const all = (result.rows as Array<Record<string, unknown>>).map(recordView);
    const hasMore = all.length > filters.limit;
    const records = hasMore ? all.slice(0, filters.limit) : all;
    return {
      records,
      page: {
        limit: filters.limit,
        offset: filters.offset,
        hasMore,
        nextOffset: hasMore ? filters.offset + filters.limit : null,
      },
    };
  }

  async record(recordId: number): Promise<ManualRecordView | null> {
    const result = await this.database.execute(recordSelectSql(recordId));
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? recordView(row) : null;
  }

  async create(input: {
    sourceId: number;
    actorUserId: number;
    rawText: string;
    captureContext: ManualRecordView['captureContext'];
    occurredAt: Date | null;
    title: string | null;
    entityId: number | null;
  }): Promise<ManualRecordView> {
    const captureContextJson = input.captureContext ? JSON.stringify(input.captureContext) : null;
    const result = await this.database.execute(sql`
      INSERT INTO worklog_records (
        source_id,
        entity_id,
        author_user_id,
        input_type,
        raw_text,
        title,
        search_terms,
        capture_context,
        ai_enrichment_status,
        occurred_at,
        status,
        version,
        created_at,
        updated_at
      ) VALUES (
        ${input.sourceId},
        ${input.entityId},
        ${input.actorUserId},
        'TEXT',
        ${input.rawText},
        ${input.title},
        '[]'::jsonb,
        ${captureContextJson}::jsonb,
        'NONE',
        ${input.occurredAt},
        'ACTIVE',
        1,
        NOW(),
        NOW()
      )
      RETURNING id::text AS id
    `);
    const id = databaseId((result.rows[0] as { id?: string } | undefined)?.id);
    if (!id) throw new Error('MANUAL_RECORD_CREATE_FAILED');
    const created = await this.record(id);
    if (!created) throw new Error('MANUAL_RECORD_CREATE_READ_FAILED');
    return created;
  }

  async mutate(input: {
    recordId: number;
    expectedVersion: number;
    actorUserId: number;
    channel: 'PWA_MANUAL' | 'PWA_DELETE' | 'PWA_RESTORE';
    rawText: string;
    occurredAt: Date | null;
    status: 'ACTIVE' | 'DELETED';
    deletedAt: Date | null;
    deletedByUserId: number | null;
  }): Promise<ManualRecordView | null> {
    const result = await this.database.execute(sql`
      WITH previous AS (
        SELECT *
        FROM worklog_records
        WHERE id = ${input.recordId}
          AND version = ${input.expectedVersion}
        LIMIT 1
      ), updated AS (
        UPDATE worklog_records record
        SET raw_text = ${input.rawText},
            occurred_at = ${input.occurredAt},
            status = ${input.status},
            deleted_at = ${input.deletedAt},
            deleted_by_user_id = ${input.deletedByUserId},
            version = record.version + 1,
            updated_at = NOW()
        FROM previous
        WHERE record.id = previous.id
          AND record.version = ${input.expectedVersion}
        RETURNING record.*
      ), revision_row AS (
        INSERT INTO worklog_record_revisions (
          record_id,
          version,
          editor_user_id,
          channel,
          previous_raw_text,
          new_raw_text,
          previous_occurred_at,
          new_occurred_at,
          previous_entity_id,
          new_entity_id,
          previous_status,
          new_status,
          created_at
        )
        SELECT previous.id,
               updated.version,
               ${input.actorUserId},
               ${input.channel},
               previous.raw_text,
               updated.raw_text,
               previous.occurred_at,
               updated.occurred_at,
               previous.entity_id,
               updated.entity_id,
               previous.status,
               updated.status,
               NOW()
        FROM previous
        INNER JOIN updated ON updated.id = previous.id
        RETURNING record_id
      )
      SELECT updated.id::text AS id
      FROM updated
    `);
    const id = databaseId((result.rows[0] as { id?: string } | undefined)?.id);
    return id ? this.record(id) : null;
  }

  async revisions(recordId: number): Promise<ManualRecordRevisionView[]> {
    const result = await this.database.execute(sql`
      SELECT revision.id::text AS id,
             revision.record_id::text AS record_id,
             revision.version,
             revision.editor_user_id::text AS editor_user_id,
             editor.display_name AS editor_display_name,
             revision.channel,
             revision.previous_raw_text,
             revision.new_raw_text,
             revision.previous_occurred_at,
             revision.new_occurred_at,
             revision.previous_entity_id::text AS previous_entity_id,
             NULL::text AS previous_title,
             revision.new_entity_id::text AS new_entity_id,
             NULL::text AS new_title,
             revision.previous_status,
             revision.new_status,
             revision.created_at
      FROM worklog_record_revisions revision
      LEFT JOIN worklog_users editor ON editor.id = revision.editor_user_id
      WHERE revision.record_id = ${recordId}
      ORDER BY revision.version DESC, revision.id DESC
      LIMIT 200
    `);
    return (result.rows as Array<Record<string, unknown>>).map(revisionView);
  }
}

function recordSelectSql(recordId: number) {
  return sql`
    SELECT record.id::text AS id,
           record.source_id::text AS source_id,
           record.entity_id::text AS entity_id,
           record.title,
           record.author_user_id::text AS author_user_id,
           author.display_name AS author_display_name,
           record.input_type,
           record.raw_text,
           record.capture_context,
           record.occurred_at,
           record.status,
           record.version,
           record.deleted_at,
           record.created_at,
           record.updated_at
    FROM worklog_records record
    LEFT JOIN worklog_users author ON author.id = record.author_user_id
    WHERE record.id = ${recordId}
    LIMIT 1
  `;
}

function recordView(raw: Record<string, unknown>): ManualRecordView {
  return {
    id: Number(raw.id),
    sourceId: Number(raw.source_id),
    entityId: nullableNumber(raw.entity_id),
    title: nullableString(raw.title),
    authorUserId: nullableNumber(raw.author_user_id),
    authorDisplayName: nullableString(raw.author_display_name),
    inputType: String(raw.input_type) as ManualRecordView['inputType'],
    rawText: String(raw.raw_text ?? ''),
    captureContext: captureContextView(raw.capture_context),
    occurredAt: dateString(raw.occurred_at),
    status: String(raw.status) as ManualRecordView['status'],
    version: Number(raw.version),
    deletedAt: dateString(raw.deleted_at),
    createdAt: dateString(raw.created_at) ?? '',
    updatedAt: dateString(raw.updated_at) ?? '',
  };
}

function captureContextView(value: unknown): ManualRecordView['captureContext'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  if (context.client !== 'CHROME_EXTENSION') return null;
  if (!context.page || typeof context.page !== 'object' || Array.isArray(context.page)) return null;
  const page = context.page as Record<string, unknown>;
  const title = nullableString(page.title);
  const url = nullableString(page.url);
  if (!title && !url) return null;
  return { client: 'CHROME_EXTENSION', page: { title, url } };
}

function revisionView(raw: Record<string, unknown>): ManualRecordRevisionView {
  return {
    id: Number(raw.id),
    recordId: Number(raw.record_id),
    version: Number(raw.version),
    editorUserId: nullableNumber(raw.editor_user_id),
    editorDisplayName: nullableString(raw.editor_display_name),
    channel: String(raw.channel),
    previousRawText: String(raw.previous_raw_text ?? ''),
    newRawText: String(raw.new_raw_text ?? ''),
    previousOccurredAt: dateString(raw.previous_occurred_at),
    newOccurredAt: dateString(raw.new_occurred_at),
    previousEntityId: nullableNumber(raw.previous_entity_id),
    previousTitle: nullableString(raw.previous_title),
    newEntityId: nullableNumber(raw.new_entity_id),
    newTitle: nullableString(raw.new_title),
    previousStatus: String(raw.previous_status) as ManualRecordRevisionView['previousStatus'],
    newStatus: String(raw.new_status) as ManualRecordRevisionView['newStatus'],
    createdAt: dateString(raw.created_at) ?? '',
  };
}

function databaseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function dateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}
