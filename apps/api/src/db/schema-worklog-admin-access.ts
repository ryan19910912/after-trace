import { bigserial, boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
export const worklogAdminRoles = pgTable('worklog_admin_roles', {
  id: varchar('id', { length: 48 }).primaryKey(), name: varchar('name', { length: 80 }).notNull(),
  permissions: jsonb('permissions').$type<string[]>().default([]).notNull(), version: integer('version').default(1).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const worklogAdminAccounts = pgTable('worklog_admin_accounts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), username: varchar('username', { length: 128 }).notNull(),
  passwordHash: text('password_hash').notNull(), roleId: varchar('role_id', { length: 48 }).notNull(),
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(), active: boolean('active').default(true).notNull(),
  tokenVersion: integer('token_version').default(1).notNull(), mustChangePassword: boolean('must_change_password').default(true).notNull(),
  failedAttempts: integer('failed_attempts').default(0).notNull(), lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('worklog_admin_accounts_username_uq').on(t.username), foreignKey({name:'worklog_admin_accounts_role_fk', columns:[t.roleId],foreignColumns:[worklogAdminRoles.id]})]);
export const worklogLocalAiModels = pgTable('worklog_local_ai_models', {
  id: integer('id').primaryKey().default(1), visionModel: varchar('vision_model', { length: 200 }).notNull(),
  visionRevision: varchar('vision_revision', { length: 64 }).notNull(), speechModel: varchar('speech_model', { length: 200 }).notNull(),
  speechRevision: varchar('speech_revision', { length: 64 }).notNull(),
  speechFallbackModel: varchar('speech_fallback_model', { length: 200 }), speechFallbackRevision: varchar('speech_fallback_revision', { length: 64 }), version: integer('version').default(1).notNull(),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
