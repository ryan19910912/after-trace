import {
  bigint,
  bigserial,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';
import { worklogAiUsageEvents } from './schema-worklog-ai-usage';

export const worklogAiGrantTypeEnum = (name: string) => varchar(name, { length: 32 });
export const worklogAiGrantStatusEnum = (name: string) => varchar(name, { length: 32 });
export const worklogAiPointReservationStatusEnum = (name: string) => varchar(name, { length: 32 });

/** User-owned AI allowance grant. */
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
    providerCostCommittedTwd: numeric('provider_cost_committed_twd', { precision: 18, scale: 8 }).default('0').notNull(),
    providerCostReservedTwd: numeric('provider_cost_reserved_twd', { precision: 18, scale: 8 }).default('0').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    originKey: varchar('origin_key', { length: 255 }).notNull(),
    metadata: jsonb('metadata').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_ai_grant_origin_uq').on(table.ownerUserId, table.originKey),
    index('worklog_ai_grant_owner_status_time_idx').on(table.ownerUserId, table.status, table.effectiveAt, table.expiresAt),
    index('worklog_ai_grant_type_status_idx').on(table.type, table.status),
  ],
);

/** Explicit Source permissions/caps for one grant. */
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
    unique('worklog_ai_grant_scope_grant_id_uq').on(table.grantId, table.id),
    index('worklog_ai_grant_scope_source_enabled_idx').on(table.sourceId, table.enabled),
  ],
);

/** One provider preflight reservation. */
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
    entitlementGrantId: bigint('entitlement_grant_id', { mode: 'number' }).references(
      () => worklogAiGrants.id,
      { onDelete: 'restrict' },
    ),
    pointsReserved: integer('points_reserved').notNull(),
    pointsCommitted: integer('points_committed').default(0).notNull(),
    platformSubsidizedPoints: integer('platform_subsidized_points').default(0).notNull(),
    providerCostHoldTwd: numeric('provider_cost_hold_twd', { precision: 18, scale: 8 }),
    status: worklogAiPointReservationStatusEnum('status').default('RESERVED').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('worklog_ai_point_reservation_source_token_uq').on(table.sourceId, table.token),
    index('worklog_ai_point_reservation_user_status_idx').on(table.chargedUserId, table.status, table.expiresAt),
    index('worklog_ai_point_reservation_source_idx').on(table.sourceId, table.createdAt),
    index('worklog_ai_point_reservation_entitlement_grant_idx').on(table.entitlementGrantId, table.status),
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
