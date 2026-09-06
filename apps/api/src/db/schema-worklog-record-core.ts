import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
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

export const worklogEntityStatusEnum = pgEnum('worklog_entity_status', ['ACTIVE', 'ARCHIVED']);
export const worklogRecordStatusEnum = pgEnum('worklog_record_status', ['ACTIVE', 'DELETED']);
export const worklogRecordAiEnrichmentStatusEnum = pgEnum('worklog_record_ai_enrichment_status', [
  'NONE',
  'ENRICHED',
  'LEGACY',
]);
export const worklogRecordRevisionChannelEnum = pgEnum('worklog_record_revision_channel', [
  'PWA_MANUAL',
  'PWA_DELETE',
  'PWA_RESTORE',
  'LINE_AI_EDIT',
  'SYSTEM',
]);
export const worklogAiConfirmationTypeEnum = pgEnum('worklog_ai_confirmation_type', [
  'ALIAS_MATCH',
  'RECORD_TITLE',
  'ENTITY_MATCH',
]);
export const worklogAiConfirmationStatusEnum = pgEnum('worklog_ai_confirmation_status', [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
]);

/** Legacy Source-scoped title model retained during the Web/PWA product migration. */
export const worklogEntities = pgTable(
  'worklog_entities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }),
    status: worklogEntityStatusEnum('status').default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_entity_source_name_uq').on(table.sourceId, sql`lower(${table.name})`),
    unique('worklog_entity_source_id_uq').on(table.sourceId, table.id),
    index('worklog_entity_source_status_idx').on(table.sourceId, table.status),
  ],
);

/** Confirmed alternate names for the legacy Source-scoped title model. */
export const worklogEntityAliases = pgTable(
  'worklog_entity_aliases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    alias: varchar('alias', { length: 255 }).notNull(),
    createdByUserId: bigint('created_by_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    createdVia: varchar('created_via', { length: 64 }).default('PWA_MANUAL').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_entity_alias_source_alias_uq').on(table.sourceId, sql`lower(${table.alias})`),
    index('worklog_entity_alias_entity_idx').on(table.entityId),
    foreignKey({
      columns: [table.sourceId, table.entityId],
      foreignColumns: [worklogEntities.sourceId, worklogEntities.id],
      name: 'worklog_entity_alias_source_entity_fk',
    }).onDelete('restrict'),
  ],
);

/**
 * Universal durable Record row.
 *
 * A free/manual Web/PWA Record is valid with only source/author/input/content plus system
 * timestamps. occurred_at is nullable because the user may not provide a business event
 * time. AI title/search/extraction metadata is optional and must never be required for
 * manual CRUD.
 *
 * entity_id and LINE trace ids are migration compatibility fields. New Web/PWA product
 * code must not require the legacy Entity/Alias model or LINE identity in order to create
 * and retrieve a Record.
 */
export const worklogRecords = pgTable(
  'worklog_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    entityId: bigint('entity_id', { mode: 'number' }),
    authorUserId: bigint('author_user_id', { mode: 'number' }).references(() => worklogUsers.id, {
      onDelete: 'restrict',
    }),
    lineMessageId: varchar('line_message_id', { length: 64 }).unique('worklog_record_line_message_uq'),
    quotedLineMessageId: varchar('quoted_line_message_id', { length: 64 }),
    inputType: worklogRecordInputTypeEnum('input_type').notNull(),
    rawText: text('raw_text').notNull(),
    title: varchar('title', { length: 255 }),
    searchTerms: jsonb('search_terms').$type<string[]>().default([]).notNull(),
    extractedMetadata: jsonb('extracted_metadata').$type<Record<string, unknown>>(),
    aiEnrichmentStatus: worklogRecordAiEnrichmentStatusEnum('ai_enrichment_status')
      .default('NONE')
      .notNull(),
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
    index('worklog_record_source_status_occurred_idx').on(
      table.sourceId,
      table.status,
      table.occurredAt,
    ),
    index('worklog_record_source_entity_status_idx').on(table.sourceId, table.entityId, table.status),
    index('worklog_record_author_type_idx').on(table.authorUserId, table.inputType),
    index('worklog_record_quoted_line_idx').on(table.quotedLineMessageId),
    index('worklog_record_ai_enrichment_idx').on(table.aiEnrichmentStatus, table.aiEnrichedAt),
    foreignKey({
      columns: [table.sourceId, table.entityId],
      foreignColumns: [worklogEntities.sourceId, worklogEntities.id],
      name: 'worklog_record_source_entity_fk',
    }).onDelete('restrict'),
  ],
);

/** Immutable snapshots for every manual/AI mutation, delete and restore. */
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
    previousEntityId: bigint('previous_entity_id', { mode: 'number' }).references(
      () => worklogEntities.id,
      { onDelete: 'restrict' },
    ),
    newEntityId: bigint('new_entity_id', { mode: 'number' }).references(
      () => worklogEntities.id,
      { onDelete: 'restrict' },
    ),
    previousStatus: worklogRecordStatusEnum('previous_status').notNull(),
    newStatus: worklogRecordStatusEnum('new_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_record_revision_record_version_uq').on(table.recordId, table.version),
    index('worklog_record_revision_record_time_idx').on(table.recordId, table.createdAt),
  ],
);

/** Durable ambiguity state for legacy AI title/entity decisions during migration. */
export const worklogAiConfirmations = pgTable(
  'worklog_ai_confirmations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    recordId: bigint('record_id', { mode: 'number' }),
    requestedUserId: bigint('requested_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    confirmationType: worklogAiConfirmationTypeEnum('confirmation_type').notNull(),
    candidateEntityId: bigint('candidate_entity_id', { mode: 'number' }),
    proposedName: varchar('proposed_name', { length: 255 }),
    payload: jsonb('payload').default({}).notNull(),
    status: worklogAiConfirmationStatusEnum('status').default('PENDING').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: bigint('resolved_by_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('worklog_ai_confirmation_source_id_uq').on(table.sourceId, table.id),
    index('worklog_ai_confirmation_user_status_idx').on(
      table.requestedUserId,
      table.status,
      table.createdAt,
    ),
    index('worklog_ai_confirmation_source_status_idx').on(table.sourceId, table.status),
    index('worklog_ai_confirmation_record_idx').on(table.recordId),
    foreignKey({
      columns: [table.sourceId, table.recordId],
      foreignColumns: [worklogRecords.sourceId, worklogRecords.id],
      name: 'worklog_ai_confirmation_source_record_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.sourceId, table.candidateEntityId],
      foreignColumns: [worklogEntities.sourceId, worklogEntities.id],
      name: 'worklog_ai_confirmation_source_entity_fk',
    }).onDelete('restrict'),
  ],
);