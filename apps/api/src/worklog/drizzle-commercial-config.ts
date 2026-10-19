import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  AiProConfigInput,
  AiProConfigSnapshot,
  CommercialConfigRepository,
  FreeAiTrialConfigSnapshot,
} from './commercial-config';

type ConfigRow = {
  free_initial_ai_trial_points: string | number;
  updated_by: string | null;
  updated_at: Date | string;
  recipients: string | number;
  exhausted_recipients: string | number;
  issued_points: string | number;
  remaining_points: string | number;
};

type AiProRow = {
  code: string;
  display_name: string;
  price_twd: string;
  enabled: boolean;
  ai_enabled: boolean;
  capabilities: unknown;
  monthly_ai_point_cap: string | number;
  monthly_provider_cost_cap_twd: string;
  per_request_ai_point_cap: string | number | null;
  updated_at: Date | string;
};

export class DrizzleCommercialConfigRepository implements CommercialConfigRepository {
  constructor(private readonly db: Database) {}

  async getFreeAiTrialConfig(): Promise<FreeAiTrialConfigSnapshot | null> {
    const result = await this.db.execute(configSelect());
    const row = result.rows[0] as ConfigRow | undefined;
    return row ? mapConfig(row) : null;
  }

  async setFreeAiTrialPoints(points: number, actor: string): Promise<FreeAiTrialConfigSnapshot> {
    const before = await this.getFreeAiTrialConfig();
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_commercial_config (
          id, free_initial_ai_trial_points, updated_by, created_at, updated_at
        )
        VALUES (1, ${points}, ${actor}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET free_initial_ai_trial_points = EXCLUDED.free_initial_ai_trial_points,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (
          actor_admin, action, target_type, target_id, before_value, after_value, created_at
        )
        SELECT ${actor}, 'FREE_AI_TRIAL_CONFIG_UPDATED', 'COMMERCIAL_CONFIG', 'free_initial_ai_trial_points',
               ${JSON.stringify(before)}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.id FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    if (!result.rows[0]) throw new Error('FREE_AI_TRIAL_CONFIG_UPDATE_FAILED');
    const snapshot = await this.getFreeAiTrialConfig();
    if (!snapshot) throw new Error('FREE_AI_TRIAL_CONFIG_UPDATE_FAILED');
    return snapshot;
  }

  async getAiProConfig(): Promise<AiProConfigSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT code, display_name, price_twd::text AS price_twd,
             enabled, ai_enabled, capabilities, monthly_ai_point_cap,
             monthly_provider_cost_cap_twd::text AS monthly_provider_cost_cap_twd,
             per_request_ai_point_cap, updated_at
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO' AND plan_type = 'SUBSCRIPTION'
      LIMIT 1
    `);
    const row = result.rows[0] as AiProRow | undefined;
    return row ? mapAiPro(row) : null;
  }

  async setAiProConfig(input: AiProConfigInput, actor: string): Promise<AiProConfigSnapshot> {
    const before = await this.getAiProConfig();
    const result = await this.db.execute(sql`
      WITH changed AS (
        INSERT INTO worklog_subscription_plans (
          code, plan_type, display_name, price_twd, rank, enabled,
          grant_points, ai_enabled, monthly_ai_point_cap,
          monthly_provider_cost_cap_twd, per_request_ai_point_cap,
          capabilities, created_at, updated_at
        )
        VALUES (
          'AI_PRO', 'SUBSCRIPTION', 'AI Pro', 99, 100, ${input.enabled},
          ${input.monthlyAiPointCap}, TRUE, ${input.monthlyAiPointCap},
          ${input.monthlyProviderCostCapTwd}, ${input.perRequestAiPointCap ?? null},
          jsonb_build_object(
            'aiMediaIngestion', ${input.aiMediaIngestion !== false},
            'aiNaturalSearch', ${input.aiNaturalSearch !== false},
            'aiRelatedRecords', ${input.aiRelatedRecords !== false},
            'aiTimeRangeSummary', ${input.aiTimeRangeSummary !== false},
            'aiRecordRewrite', ${input.aiRecordRewrite !== false},
            'aiTaskProposal', ${input.aiTaskProposal !== false}
          ),
          NOW(), NOW()
        )
        ON CONFLICT (code) DO UPDATE
        SET plan_type = 'SUBSCRIPTION', display_name = 'AI Pro', price_twd = 99,
            enabled = EXCLUDED.enabled,
            grant_points = EXCLUDED.grant_points,
            ai_enabled = TRUE,
            monthly_ai_point_cap = EXCLUDED.monthly_ai_point_cap,
            monthly_provider_cost_cap_twd = EXCLUDED.monthly_provider_cost_cap_twd,
            per_request_ai_point_cap = EXCLUDED.per_request_ai_point_cap,
            capabilities = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        COALESCE(worklog_subscription_plans.capabilities, '{}'::jsonb),
                        '{aiMediaIngestion}', to_jsonb(${input.aiMediaIngestion !== false}::boolean), TRUE
                      ),
                      '{aiNaturalSearch}', to_jsonb(${input.aiNaturalSearch !== false}::boolean), TRUE
                    ),
                    '{aiRelatedRecords}', to_jsonb(${input.aiRelatedRecords !== false}::boolean), TRUE
                  ),
                  '{aiTimeRangeSummary}', to_jsonb(${input.aiTimeRangeSummary !== false}::boolean), TRUE
                ),
                '{aiRecordRewrite}', to_jsonb(${input.aiRecordRewrite !== false}::boolean), TRUE
              ),
              '{aiTaskProposal}', to_jsonb(${input.aiTaskProposal !== false}::boolean), TRUE
            ),
            updated_at = NOW()
        RETURNING *
      ), audit AS (
        INSERT INTO worklog_audit_logs (
          actor_admin, action, target_type, target_id, before_value, after_value, created_at
        )
        SELECT ${actor}, 'AI_PRO_CONFIG_UPDATED', 'PLAN', 'AI_PRO',
               ${JSON.stringify(before)}::jsonb, to_jsonb(changed), NOW()
        FROM changed RETURNING id
      )
      SELECT changed.code FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    if (!result.rows[0]) throw new Error('AI_PRO_CONFIG_UPDATE_FAILED');
    const snapshot = await this.getAiProConfig();
    if (!snapshot) throw new Error('AI_PRO_CONFIG_UPDATE_FAILED');
    return snapshot;
  }
}

function configSelect() {
  return sql`
    SELECT config.free_initial_ai_trial_points, config.updated_by, config.updated_at,
      COUNT(ai_grant.id)::bigint AS recipients,
      COUNT(ai_grant.id) FILTER (WHERE ai_grant.status = 'EXHAUSTED' OR ai_grant.remaining_points = 0)::bigint AS exhausted_recipients,
      COALESCE(SUM(ai_grant.original_points), 0)::bigint AS issued_points,
      COALESCE(SUM(ai_grant.remaining_points), 0)::bigint AS remaining_points
    FROM worklog_commercial_config AS config
    LEFT JOIN worklog_ai_grants AS ai_grant ON ai_grant.type = 'FREE_INITIAL'
    WHERE config.id = 1
    GROUP BY config.id
    LIMIT 1
  `;
}

function mapConfig(row: ConfigRow): FreeAiTrialConfigSnapshot {
  const issuedPoints = integer(row.issued_points); const remainingPoints = integer(row.remaining_points);
  return {
    freeInitialAiTrialPoints: integer(row.free_initial_ai_trial_points), updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(), recipients: integer(row.recipients),
    exhaustedRecipients: integer(row.exhausted_recipients), issuedPoints, remainingPoints,
    consumedPoints: Math.max(0, issuedPoints - remainingPoints),
  };
}

function mapAiPro(row: AiProRow): AiProConfigSnapshot {
  if (row.code !== 'AI_PRO' || Number(row.price_twd) !== 99) throw new Error('INVALID_AI_PRO_COMMERCIAL_SHAPE');
  const capabilities = plainObject(row.capabilities);
  return {
    code: 'AI_PRO', displayName: row.display_name, priceTwd: '99.00', enabled: Boolean(row.enabled), aiEnabled: Boolean(row.ai_enabled),
    aiMediaIngestion: capabilities.aiMediaIngestion !== false,
    aiNaturalSearch: capabilities.aiNaturalSearch !== false,
    aiRelatedRecords: capabilities.aiRelatedRecords !== false,
    aiTimeRangeSummary: capabilities.aiTimeRangeSummary !== false,
    aiRecordRewrite: capabilities.aiRecordRewrite !== false,
    aiTaskProposal: capabilities.aiTaskProposal !== false,
    monthlyAiPointCap: positiveInteger(row.monthly_ai_point_cap),
    monthlyProviderCostCapTwd: positiveDecimal(row.monthly_provider_cost_cap_twd),
    perRequestAiPointCap: row.per_request_ai_point_cap === null ? null : positiveInteger(row.per_request_ai_point_cap),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function plainObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function integer(value: string | number) { const parsed=Number(value); if(!Number.isSafeInteger(parsed)||parsed<0) throw new Error('INVALID_COMMERCIAL_CONFIG_VALUE'); return parsed; }
function positiveInteger(value: string | number) { const parsed=Number(value); if(!Number.isSafeInteger(parsed)||parsed<=0) throw new Error('INVALID_AI_PRO_CONFIG_VALUE'); return parsed; }
function positiveDecimal(value: string | number) { const parsed=Number(value); if(!Number.isFinite(parsed)||parsed<=0) throw new Error('INVALID_AI_PRO_CONFIG_VALUE'); return String(value); }
