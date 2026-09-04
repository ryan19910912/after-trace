import {
  bigint,
  bigserial,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';
import { worklogAiUsageEvents } from './schema-worklog-ai-usage';

export const worklogAiGrantTypeEnum = pgEnum('worklog_ai_grant_type', [
  'FREE_INITIAL',
  'SUBSCRIPTION_PERIOD',
  'TOP_UP',
  'ADMIN',
]);

export const worklogAiGrantStatusEnum = pgEnum('worklog_ai_grant_status', [
  'ACTIVE',
  'EXHAUSTED',
  'REVOKED',
]);

export const worklogAiPointReservationStatusEnum = pgEnum('worklog_ai_point_reservation_status', [
  'RESERVED',
  'COMMITTED',
  'RELEASED',
  'EXPIRED',
]);

/**
 * User-owned AI allowance grant.
 *
 * FREE, each successful subscription period, and each top-up are separate rows. A
 * later plan/pricing change never resizes historical grants. remaining_points is the
 * currently available customer balance after active reservation holds; provider
 * overage subsidy is accounted on usage events and never drives this value negative.
 */
export const worklogAiGrants = pgTable(
  'worklog_ai_grants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: bigint('owner_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    type: worklogAiGrantTypeEnum('type').notNull(),
    status: worklogAiGrantStatusEnum('status').default('ACTIVE').notNull(),
    originalPoints: integer('original_points').notNull(),
    remainingPoints: integer('remaining_points').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    originKey: varchar('origin_key', { length: 255 }).notNull(),
    metadata: jsonb('metadata').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_ai_grant_origin_uq').on(table.ownerUserId, table.originKey),
    index('worklog_ai_grant_owner_status_time_idx').on(
      table.ownerUserId,
      table.status,
      table.effectiveAt,
      table.expiresAt,
    ),
    index('worklog_ai_grant_type_status_idx').on(table.type, table.status),
  ],
);

/**
 * Explicit Source permissions/caps for one grant.
 *
 * A grant is never an implicit fallback for every Source. PRIVATE and selected GROUP
 * Sources must be represented explicitly. cap_points NULL means the grant may use its
 * full remaining balance in that Source. used_points is committed customer usage;
 * reserved_points is a temporary provider preflight hold so concurrent requests cannot
 * oversubscribe a Source cap.
 */
export const worklogAiGrantScopes = pgTable(
  'worklog_ai_grant_scopes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    grantId: bigint('grant_id', { mode: 'number' })
      .notNull()
      .references(() => worklogAiGrants.id, { onDelete: 'restrict' }),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    capPoints: integer('cap_points'),
    usedPoints: integer('used_points').default(0).notNull(),
    reservedPoints: integer('reserved_points').default(0).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_ai_grant_scope_uq').on(table.grantId, table.sourceId),
    // Composite funding FKs below use this key so a funding row cannot pair grant A
    // with a scope owned by grant B.
    uniqueIndex('worklog_ai_grant_scope_grant_id_uq').on(table.grantId, table.id),
    index('worklog_ai_grant_scope_source_enabled_idx').on(table.sourceId, table.enabled),
  ],
);

/** Current GROUP AI 額度負責人; GROUP data existence does not depend on this row. */
export const worklogSourceAiResponsibility = pgTable(
  'worklog_source_ai_responsibility',
  {
    sourceId: bigint('source_id', { mode: 'number' })
      .primaryKey()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    responsibleUserId: bigint('responsible_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    assignedByUserId: bigint('assigned_by_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_source_ai_responsibility_user_idx').on(table.responsibleUserId)],
);

/** Immutable transfer/recovery audit for the GROUP AI 額度負責人 role. */
export const worklogSourceAiResponsibilityHistory = pgTable(
  'worklog_source_ai_responsibility_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    previousUserId: bigint('previous_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    nextUserId: bigint('next_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    actorUserId: bigint('actor_user_id', { mode: 'number' }).references(
      () => worklogUsers.id,
      { onDelete: 'restrict' },
    ),
    reason: varchar('reason', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('worklog_source_ai_responsibility_history_source_idx').on(table.sourceId, table.createdAt)],
);

/**
 * One provider preflight reservation. Funding may span multiple eligible grants, so
 * reservation funding is normalized into child rows rather than attaching one grant.
 */
export const worklogAiPointReservations = pgTable(
  'worklog_ai_point_reservations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    token: varchar('token', { length: 64 }).notNull().unique('worklog_ai_point_reservation_token_uq'),
    chargedUserId: bigint('charged_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    actorUserId: bigint('actor_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'restrict' }),
    pointsReserved: integer('points_reserved').notNull(),
    pointsCommitted: integer('points_committed').default(0).notNull(),
    platformSubsidizedPoints: integer('platform_subsidized_points').default(0).notNull(),
    status: worklogAiPointReservationStatusEnum('status').default('RESERVED').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_ai_point_reservation_user_status_idx').on(table.chargedUserId, table.status, table.expiresAt),
    index('worklog_ai_point_reservation_source_idx').on(table.sourceId, table.createdAt),
  ],
);

export const worklogAiPointReservationFunding = pgTable(
  'worklog_ai_point_reservation_funding',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reservationId: bigint('reservation_id', { mode: 'number' })
      .notNull()
      .references(() => worklogAiPointReservations.id, { onDelete: 'restrict' }),
    grantId: bigint('grant_id', { mode: 'number' })
      .notNull()
      .references(() => worklogAiGrants.id, { onDelete: 'restrict' }),
    grantScopeId: bigint('grant_scope_id', { mode: 'number' }).notNull(),
    pointsReserved: integer('points_reserved').notNull(),
    pointsCharged: integer('points_charged').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_ai_point_reservation_funding_uq').on(table.reservationId, table.grantId, table.grantScopeId),
    index('worklog_ai_point_reservation_funding_grant_idx').on(table.grantId, table.createdAt),
    foreignKey({
      columns: [table.grantId, table.grantScopeId],
      foreignColumns: [worklogAiGrantScopes.grantId, worklogAiGrantScopes.id],
      name: 'worklog_ai_point_reservation_funding_grant_scope_fk',
    }).onDelete('restrict'),
  ],
);

/** Exact customer-grant funding attribution for one successful provider usage event. */
export const worklogAiUsageFunding = pgTable(
  'worklog_ai_usage_funding',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    usageEventId: bigint('usage_event_id', { mode: 'number' })
      .notNull()
      .references(() => worklogAiUsageEvents.id, { onDelete: 'restrict' }),
    grantId: bigint('grant_id', { mode: 'number' })
      .notNull()
      .references(() => worklogAiGrants.id, { onDelete: 'restrict' }),
    grantScopeId: bigint('grant_scope_id', { mode: 'number' }).notNull(),
    pointsCharged: integer('points_charged').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_ai_usage_funding_uq').on(table.usageEventId, table.grantId, table.grantScopeId),
    index('worklog_ai_usage_funding_grant_idx').on(table.grantId, table.createdAt),
    foreignKey({
      columns: [table.grantId, table.grantScopeId],
      foreignColumns: [worklogAiGrantScopes.grantId, worklogAiGrantScopes.id],
      name: 'worklog_ai_usage_funding_grant_scope_fk',
    }).onDelete('restrict'),
  ],
);
