import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type SettingKind = 'text' | 'positive-number' | 'positive-integer';
export type OperationalSettingDefinition = {
  key: string;
  section: 'AI & Pricing' | 'Energy' | 'Subscription' | 'Paid Packs' | 'Rewarded Ad' | 'Safety / Budget' | 'Retention';
  label: string;
  kind: SettingKind;
  defaultValue?: string;
};

export const operationalSettingDefinitions: OperationalSettingDefinition[] = [
  { key: 'GEMINI_MODEL', section: 'AI & Pricing', label: 'Gemini model', kind: 'text', defaultValue: 'gemini-2.5-flash-lite' },
  { key: 'GEMINI_INPUT_USD_PER_MILLION_TOKENS', section: 'AI & Pricing', label: 'Input USD / 1M tokens', kind: 'positive-number' },
  { key: 'GEMINI_OUTPUT_USD_PER_MILLION_TOKENS', section: 'AI & Pricing', label: 'Output USD / 1M tokens', kind: 'positive-number' },
  { key: 'USD_TWD_RATE', section: 'AI & Pricing', label: 'USD/TWD rate', kind: 'positive-number' },
  { key: 'GEMINI_CHAT_MAX_OUTPUT_TOKENS', section: 'AI & Pricing', label: 'Chat max output tokens', kind: 'positive-integer', defaultValue: '512' },
  { key: 'GEMINI_MEMORY_MAX_OUTPUT_TOKENS', section: 'AI & Pricing', label: 'Memory max output tokens', kind: 'positive-integer' },
  { key: 'ENERGY_UNITS_PER_TWD', section: 'Energy', label: 'Energy units / provider TWD', kind: 'positive-number' },
  { key: 'FREE_INITIAL_ENERGY', section: 'Energy', label: 'Lifetime FREE Energy', kind: 'positive-integer' },
  { key: 'REMINDER_RESERVATION_ENERGY', section: 'Energy', label: 'Reminder reservation Energy', kind: 'positive-integer' },
  { key: 'SUBSCRIPTION_MONTHLY_ENERGY', section: 'Subscription', label: 'Monthly Energy', kind: 'positive-integer' },
  { key: 'SUBSCRIPTION_PRICE_TWD', section: 'Subscription', label: 'Subscription price TWD', kind: 'positive-number' },
  { key: 'PAID_PACK_SMALL_ENERGY', section: 'Paid Packs', label: 'Small pack Energy', kind: 'positive-integer' },
  { key: 'PAID_PACK_SMALL_PRICE_TWD', section: 'Paid Packs', label: 'Small pack price TWD', kind: 'positive-number' },
  { key: 'PAID_PACK_MEDIUM_ENERGY', section: 'Paid Packs', label: 'Medium pack Energy', kind: 'positive-integer' },
  { key: 'PAID_PACK_MEDIUM_PRICE_TWD', section: 'Paid Packs', label: 'Medium pack price TWD', kind: 'positive-number' },
  { key: 'PAID_PACK_LARGE_ENERGY', section: 'Paid Packs', label: 'Large pack Energy', kind: 'positive-integer' },
  { key: 'PAID_PACK_LARGE_PRICE_TWD', section: 'Paid Packs', label: 'Large pack price TWD', kind: 'positive-number' },
  { key: 'REWARDED_AD_ENERGY', section: 'Rewarded Ad', label: 'Reward Energy', kind: 'positive-integer' },
  { key: 'REWARDED_AD_DAILY_LIMIT', section: 'Rewarded Ad', label: 'Daily limit', kind: 'positive-integer', defaultValue: '5' },
  { key: 'REWARDED_AD_COOLDOWN_MINUTES', section: 'Rewarded Ad', label: 'Cooldown minutes', kind: 'positive-integer', defaultValue: '15' },
  { key: 'GLOBAL_FREE_AI_BUDGET_COST_TWD', section: 'Safety / Budget', label: 'Global platform AI budget TWD', kind: 'positive-number' },
  { key: 'BACKGROUND_AI_MAX_SUBSIDY_COST_TWD', section: 'Safety / Budget', label: 'Background AI max subsidy / call TWD', kind: 'positive-number' },
  { key: 'UNPAID_RETENTION_DAYS', section: 'Retention', label: 'Unpaid retention days', kind: 'positive-integer', defaultValue: '30' },
  { key: 'PAID_RETENTION_DAYS', section: 'Retention', label: 'Paid retention days', kind: 'positive-integer', defaultValue: '365' },
];

const definitions = new Map(operationalSettingDefinitions.map((item) => [item.key, item]));

export async function loadOperationalRuntimeEnv(db: Database): Promise<Record<string, string>> {
  const result = await db.execute(sql`SELECT key, value FROM operational_settings`);
  const values: Record<string, string> = {};
  for (const definition of operationalSettingDefinitions) if (definition.defaultValue !== undefined) values[definition.key] = definition.defaultValue;
  for (const row of result.rows as Array<{ key: string; value: unknown }>) {
    if (!definitions.has(row.key) || row.value === null || row.value === undefined) continue;
    values[row.key] = String(row.value);
  }
  return values;
}

export async function listOperationalSettings(db: Database) {
  const result = await db.execute(sql`SELECT key, value, updated_by, updated_at FROM operational_settings`);
  const current = new Map((result.rows as Array<{ key: string; value: unknown; updated_by: string; updated_at: Date }>).map((row) => [row.key, row]));
  return operationalSettingDefinitions.map((definition) => {
    const row = current.get(definition.key);
    return { ...definition, value: row?.value === null || row?.value === undefined ? definition.defaultValue ?? null : String(row.value), source: row ? 'DATABASE' : definition.defaultValue !== undefined ? 'DEFAULT' : 'UNCONFIGURED', updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null };
  });
}

export async function updateOperationalSetting(db: Database, key: string, rawValue: unknown, actor: string) {
  const definition = definitions.get(key);
  if (!definition) throw new Error('UNKNOWN_SETTING');
  const value = validate(definition, rawValue);
  await db.execute(sql`
    WITH previous AS (
      SELECT value FROM operational_settings WHERE key = ${key}
    ), upserted AS (
      INSERT INTO operational_settings (key, value, updated_by)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${actor})
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING value
    )
    INSERT INTO operational_setting_changes (key, before_value, after_value, changed_by)
    SELECT ${key}, (SELECT value FROM previous), (SELECT value FROM upserted), ${actor}
  `);
  return { key, value };
}

function validate(definition: OperationalSettingDefinition, raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('SETTING_VALUE_REQUIRED');
  const value = String(raw).trim();
  if (!value) throw new Error('SETTING_VALUE_REQUIRED');
  if (definition.kind === 'text') {
    if (value.length > 128) throw new Error('SETTING_VALUE_TOO_LONG');
    return value;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('SETTING_VALUE_MUST_BE_POSITIVE');
  if (definition.kind === 'positive-integer' && !Number.isSafeInteger(parsed)) throw new Error('SETTING_VALUE_MUST_BE_INTEGER');
  return value;
}
