import { bigserial, index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const operationalSettings = pgTable(
  'operational_settings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: varchar('key', { length: 128 }).notNull(),
    value: jsonb('value'),
    updatedBy: varchar('updated_by', { length: 320 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('operational_setting_key_uq').on(table.key)],
);

export const operationalSettingChanges = pgTable(
  'operational_setting_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: varchar('key', { length: 128 }).notNull(),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    changedBy: varchar('changed_by', { length: 320 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('operational_setting_change_created_idx').on(table.createdAt)],
);
