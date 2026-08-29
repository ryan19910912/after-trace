import {
  bigint,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const memoryClassifierResults = pgTable('memory_classifier_results', {
  requestId: bigint('request_id', { mode: 'number' }).primaryKey(),
  attemptCount: integer('attempt_count').notNull(),
  provider: varchar('provider', { length: 32 }).notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  providerResponseId: varchar('provider_response_id', { length: 128 }),
  structuredOutput: jsonb('structured_output').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  latencyMs: integer('latency_ms'),
  inputUsdPerMillionTokens: numeric('input_usd_per_million_tokens', { precision: 18, scale: 10 }).notNull(),
  outputUsdPerMillionTokens: numeric('output_usd_per_million_tokens', { precision: 18, scale: 10 }).notNull(),
  usdTwdRate: numeric('usd_twd_rate', { precision: 12, scale: 6 }).notNull(),
  costUsd: numeric('cost_usd', { precision: 18, scale: 10 }).notNull(),
  costTwd: numeric('cost_twd', { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
