import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  ClassifierResultStoreOutcome,
  MemoryClassifierResultRepository,
  ValidatedClassifierResult,
} from './classifier-result';
import { memoryClassifierOutputSchema } from './classifier-contract';

type ResultRow = {
  request_id: string;
  attempt_count: number;
  provider: 'GOOGLE';
  model: string;
  provider_response_id: string | null;
  structured_output: unknown;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  input_usd_per_million_tokens: string;
  output_usd_per_million_tokens: string;
  usd_twd_rate: string;
  cost_usd: string;
  cost_twd: string;
  created_at: Date;
  storage_status?: 'STORED' | 'ALREADY_STORED';
};

const projection = sql.raw(`
  request_id::text AS request_id,
  attempt_count,
  provider,
  model,
  provider_response_id,
  structured_output,
  input_tokens,
  output_tokens,
  latency_ms,
  input_usd_per_million_tokens::text AS input_usd_per_million_tokens,
  output_usd_per_million_tokens::text AS output_usd_per_million_tokens,
  usd_twd_rate::text AS usd_twd_rate,
  cost_usd::text AS cost_usd,
  cost_twd::text AS cost_twd,
  created_at
`);

export class DrizzleMemoryClassifierResultRepository implements MemoryClassifierResultRepository {
  constructor(private readonly db: Database) {}

  async findByRequestId(requestId: number): Promise<ValidatedClassifierResult | null> {
    const result = await this.db.execute(sql`
      SELECT ${projection}
      FROM memory_classifier_results
      WHERE request_id = ${requestId}
      LIMIT 1
    `);
    const row = result.rows[0] as ResultRow | undefined;
    return row ? mapRow(row) : null;
  }

  async storeIfCurrent(
    input: Parameters<MemoryClassifierResultRepository['storeIfCurrent']>[0],
  ): Promise<ClassifierResultStoreOutcome> {
    const value = input.result;
    const result = await this.db.execute(sql`
      WITH owned AS MATERIALIZED (
        SELECT request.id
        FROM memory_candidate_requests request
        JOIN memory_request_work_states work ON work.request_id = request.id
        WHERE request.id = ${input.requestId}
          AND request.group_id = ${input.groupId}
          AND request.status = 'CLAIMED'
          AND work.attempt_count = ${input.attemptCount}
        FOR UPDATE OF request, work
      ),
      inserted AS (
        INSERT INTO memory_classifier_results (
          request_id, attempt_count, provider, model, provider_response_id,
          structured_output, input_tokens, output_tokens, latency_ms,
          input_usd_per_million_tokens, output_usd_per_million_tokens,
          usd_twd_rate, cost_usd, cost_twd, created_at
        )
        SELECT
          ${input.requestId}, ${input.attemptCount}, ${value.provider}, ${value.model},
          ${value.providerResponseId}, ${JSON.stringify(value.output)}::jsonb,
          ${value.inputTokens}, ${value.outputTokens}, ${value.latencyMs},
          ${value.inputUsdPerMillionTokens}, ${value.outputUsdPerMillionTokens},
          ${value.usdTwdRate}, ${value.costUsd}, ${value.costTwd}, ${value.createdAt}
        FROM owned
        ON CONFLICT (request_id) DO NOTHING
        RETURNING *, 'STORED'::text AS storage_status
      ),
      selected AS (
        SELECT * FROM inserted
        UNION ALL
        SELECT existing.*, 'ALREADY_STORED'::text AS storage_status
        FROM memory_classifier_results existing
        WHERE existing.request_id = ${input.requestId}
          AND NOT EXISTS (SELECT 1 FROM inserted)
      )
      SELECT ${projection}, storage_status
      FROM selected
      LIMIT 1
    `);

    const row = result.rows[0] as ResultRow | undefined;
    if (!row) return { status: 'STALE_CLAIM' };
    return {
      status: row.storage_status === 'STORED' ? 'STORED' : 'ALREADY_STORED',
      result: mapRow(row),
    };
  }
}

function mapRow(row: ResultRow): ValidatedClassifierResult {
  return {
    requestId: Number(row.request_id),
    attemptCount: row.attempt_count,
    provider: row.provider,
    model: row.model,
    providerResponseId: row.provider_response_id,
    output: memoryClassifierOutputSchema.parse(row.structured_output),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    inputUsdPerMillionTokens: row.input_usd_per_million_tokens,
    outputUsdPerMillionTokens: row.output_usd_per_million_tokens,
    usdTwdRate: row.usd_twd_rate,
    costUsd: row.cost_usd,
    costTwd: row.cost_twd,
    createdAt: new Date(row.created_at),
  };
}
