import { bigserial, foreignKey, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const worklogLocalAiPrompts = pgTable('worklog_local_ai_prompts', {
  key: varchar('key', { length: 48 }).primaryKey(),
  draftTemplate: text('draft_template').notNull(),
  publishedTemplate: text('published_template').notNull(),
  draftMaxTokens: integer('draft_max_tokens').notNull(),
  publishedMaxTokens: integer('published_max_tokens').notNull(),
  version: integer('version').default(1).notNull(),
  publishedVersion: integer('published_version').default(1).notNull(),
  updatedBy: varchar('updated_by', { length: 128 }).notNull(),
  publishedBy: varchar('published_by', { length: 128 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
});
export const worklogLocalAiPromptRevisions = pgTable('worklog_local_ai_prompt_revisions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  promptKey: varchar('prompt_key', { length: 48 }).notNull(),
  action: varchar('action', { length: 24 }).notNull(),
  version: integer('version').notNull(),
  template: text('template').notNull(),
  maxTokens: integer('max_tokens').notNull(),
  actor: varchar('actor', { length: 128 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [foreignKey({ name: 'worklog_local_prompt_revisions_prompt_fk', columns: [table.promptKey], foreignColumns: [worklogLocalAiPrompts.key] }), index('worklog_local_ai_prompt_revisions_key_id_idx').on(table.promptKey, table.id)]);
