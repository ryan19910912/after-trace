import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  worklogRecordInputTypeEnum,
  worklogSources,
  worklogUsers,
} from './schema-worklog';

export const worklogRecordStatusEnum = (name: string) => varchar(name, { length: 32 });
export const worklogRecordAiEnrichmentStatusEnum = (name: string) => varchar(name, { length: 32 });
export const worklogRecordRevisionChannelEnum = (name: string) => varchar(name, { length: 32 });

/**
 * Universal durable Record row for the target Web/PWA/Extension product.
 * Manual records require only source/author/input/content plus timestamps; AI metadata is optional.
 */
export const worklogRecords = pgTable(
  'worklog_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    authorUserId: bigint('author_user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    inputType: worklogRecordInputTypeEnum('input_type').notNull(),
    rawText: text('raw_text').notNull(),
    title: varchar('title', { length: 255 }),
    searchTerms: jsonb('search_terms').$type<string[]>().default([]).notNull(),
    extractedMetadata: jsonb('extracted_metadata').$type<Record<string, unknown>>(),
    captureContext: jsonb('capture_context').$type<Record<string, unknown>>(),
    aiEnrichmentStatus: worklogRecordAiEnrichmentStatusEnum('ai_enrichment_status').default('NONE').notNull(),
    aiEnrichedAt: timestamp('ai_enriched_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    status: worklogRecordStatusEnum('status').default('ACTIVE').notNull(),
    version: integer('version').default(1).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: bigint('deleted_by_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('worklog_record_source_id_uq').on(table.sourceId, table.id),
    index('worklog_record_source_status_occurred_idx').on(table.sourceId, table.status, table.occurredAt),
    index('worklog_record_author_type_idx').on(table.authorUserId, table.inputType),
    index('worklog_record_ai_enrichment_idx').on(table.aiEnrichmentStatus, table.aiEnrichedAt),
  ],
);

/** Immutable snapshots for every durable Record mutation, delete and restore. */
export const worklogRecordRevisions = pgTable(
  'worklog_record_revisions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    recordId: bigint('record_id', { mode: 'number' })
      .notNull()
      .references(() => worklogRecords.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    editorUserId: bigint('editor_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    channel: worklogRecordRevisionChannelEnum('channel').notNull(),
    previousRawText: text('previous_raw_text').notNull(),
    newRawText: text('new_raw_text').notNull(),
    previousOccurredAt: timestamp('previous_occurred_at', { withTimezone: true }),
    newOccurredAt: timestamp('new_occurred_at', { withTimezone: true }),
    previousStatus: worklogRecordStatusEnum('previous_status').notNull(),
    newStatus: worklogRecordStatusEnum('new_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_record_revision_record_version_uq').on(table.recordId, table.version),
    index('worklog_record_revision_record_time_idx').on(table.recordId, table.createdAt),
  ],
);
