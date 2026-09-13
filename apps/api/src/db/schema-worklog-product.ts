import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { worklogSources, worklogUsers } from './schema-worklog';

export const worklogAuthProviderEnum = (name: string) => varchar(name, { length: 32 });

/** Provider-neutral identity binding for target Web/PWA authentication. */
export const worklogAuthIdentities = pgTable(
  'worklog_auth_identities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'cascade' }),
    provider: worklogAuthProviderEnum('provider').notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    emailSnapshot: varchar('email_snapshot', { length: 320 }),
    displayNameSnapshot: varchar('display_name_snapshot', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_auth_identity_provider_subject_uq').on(table.provider, table.subject),
    index('worklog_auth_identity_user_idx').on(table.userId),
  ],
);

/** One immutable customer-facing support/account id per AFTERTRACE user. */
export const worklogUserPublicAccounts = pgTable(
  'worklog_user_public_accounts',
  {
    userId: bigint('user_id', { mode: 'number' })
      .primaryKey()
      .references(() => worklogUsers.id, { onDelete: 'cascade' }),
    publicAccountId: varchar('public_account_id', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('worklog_user_public_account_id_uq').on(table.publicAccountId)],
);

/** Revocable AFTERTRACE-native invite token metadata. */
export const worklogSourceInvites = pgTable(
  'worklog_source_invites',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => worklogSources.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    createdByUserId: bigint('created_by_user_id', { mode: 'number' })
      .notNull()
      .references(() => worklogUsers.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worklog_source_invite_token_hash_uq').on(table.tokenHash),
    index('worklog_source_invite_source_active_idx').on(table.sourceId, table.revokedAt, table.expiresAt),
  ],
);
