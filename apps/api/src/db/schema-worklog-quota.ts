import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';

export const worklogAiReservationStatusEnum = pgEnum('worklog_ai_reservation_status', [
  'RESERVED',
  'COMMITTED',
  'RELEASED',
  'EXPIRED',
]);

export const worklogAiQuotaBalances = pgTable(
  'worklog_ai_quota_balances',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    allowanceUnits: integer('allowance_units').default(0).notNull(),
    usedUnits: integer('used_units').default(0).notNull(),
    reservedUnits: integer('reserved_units').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_ai_quota_balance_user_period_uq').on(table.userId, table.periodStart),
    index('worklog_ai_quota_balance_user_time_idx').on(table.userId, table.periodStart, table.periodEnd),
  ],
);

export const worklogAiQuotaReservations = pgTable(
  'worklog_ai_quota_reservations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    token: varchar('token', { length: 64 }).notNull().unique('worklog_ai_quota_reservation_token_uq'),
    chargedUserId: bigint('charged_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    actorUserId: bigint('actor_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    sourceId: bigint('source_id', { mode: 'number' }).references(() => worklogSources.id, {
      onDelete: 'restrict',
    }),
    unitsReserved: integer('units_reserved').notNull(),
    unitsCommitted: integer('units_committed').default(0).notNull(),
    status: worklogAiReservationStatusEnum('status').default('RESERVED').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('worklog_ai_quota_reservation_charged_status_expiry_idx').on(
      table.chargedUserId,
      table.status,
      table.expiresAt,
    ),
    index('worklog_ai_quota_reservation_source_actor_idx').on(
      table.sourceId,
      table.actorUserId,
      table.createdAt,
    ),
  ],
);
