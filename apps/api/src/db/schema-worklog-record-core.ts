import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogRecords, worklogSources, worklogUsers } from './schema-worklog';

export const worklogEntityStatusEnum = pgEnum('worklog_entity_status', ['ACTIVE', 'ARCHIVED']);
export const worklogRecordStatusEnum = pgEnum('worklog_record_status', ['ACTIVE', 'DELETED']);
export const worklogRecordRevisionChannelEnum = pgEnum('worklog_record_revision_channel', [
  'PWA_MANUAL',
  'LINE_AI_EDIT',
  'RESTORE',
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

/**
 * Source-scoped user-facing 紀錄標題.
 *
 * This is the accepted single-title MVP model. Do not add PRIMARY/RELATED
 * multi-Entity associations around this table.
 */
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
    uniqueIndex('worklog_entity_source_name_uq').on(table.sourceId, table.name),
    index('worklog_entity_source_status_idx').on(table.sourceId, table.status),
  ],
);

/** Confirmed alternate names for one title. */
export const worklogEntityAliases = pgTable(
  'worklog_entity_aliases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => worklogEntities.id, { onDelete: 'restrict' }),
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
    uniqueIndex('worklog_entity_alias_source_alias_uq').on(table.sourceId, table.alias),
    index('worklog_entity_alias_entity_idx').on(table.entityId),
  ],
);

/**
 * Immutable snapshots for every content/time/title changing Record edit.
 *
 * The legacy worklog_records row does not yet expose the final entity/status/version
 * columns; those columns are added in the next destructive core-record batch. This
 * revision table is intentionally created first so downstream services can target the
 * final audit contract without reintroducing Customer/Project/finance semantics.
 */
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
    previousRawText: text('previous_raw_text'),
    newRawText: text('new_raw_text'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_record_revision_record_version_uq').on(table.recordId, table.version),
    index('worklog_record_revision_record_time_idx').on(table.recordId, table.createdAt),
  ],
);

/** Durable ambiguity state for AI title/entity decisions. */
export const worklogAiConfirmations = pgTable(
  'worklog_ai_confirmations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    recordId: bigint('record_id', { mode: 'number' }).references(() => worklogRecords.id, {
      onDelete: 'restrict',
    }),
    requestedUserId: bigint('requested_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    confirmationType: worklogAiConfirmationTypeEnum('confirmation_type').notNull(),
    candidateEntityId: bigint('candidate_entity_id', { mode: 'number' }).references(
      () => worklogEntities.id,
      { onDelete: 'restrict' },
    ),
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
    index('worklog_ai_confirmation_user_status_idx').on(
      table.requestedUserId,
      table.status,
      table.createdAt,
    ),
    index('worklog_ai_confirmation_source_status_idx').on(table.sourceId, table.status),
    index('worklog_ai_confirmation_record_idx').on(table.recordId),
  ],
);
