import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { CommercialConfigRepository, FreeAiTrialConfigSnapshot } from './commercial-config';

type ConfigRow = {
  free_initial_ai_trial_points: string | number;
  updated_by: string | null;
  updated_at: Date | string;
  recipients: string | number;
  exhausted_recipients: string | number;
  issued_points: string | number;
  remaining_points: string | number;
};

export class DrizzleCommercialConfigRepository implements CommercialConfigRepository {
  constructor(private readonly db: Database) {}

  async getFreeAiTrialConfig(): Promise<FreeAiTrialConfigSnapshot | null> {
    const result = await this.db.execute(sql`${configSelect()} WHERE config.id = 1 LIMIT 1`);
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
        SELECT ${actor},
               'FREE_AI_TRIAL_CONFIG_UPDATED',
               'COMMERCIAL_CONFIG',
               'free_initial_ai_trial_points',
               ${JSON.stringify(before)}::jsonb,
               to_jsonb(changed),
               NOW()
        FROM changed
        RETURNING id
      )
      SELECT changed.id FROM changed WHERE EXISTS (SELECT 1 FROM audit)
    `);
    if (!result.rows[0]) throw new Error('FREE_AI_TRIAL_CONFIG_UPDATE_FAILED');
    const snapshot = await this.getFreeAiTrialConfig();
    if (!snapshot) throw new Error('FREE_AI_TRIAL_CONFIG_UPDATE_FAILED');
    return snapshot;
  }
}

function configSelect() {
  return sql`
    SELECT
      config.free_initial_ai_trial_points,
      config.updated_by,
      config.updated_at,
      COUNT(ai_grant.id)::bigint AS recipients,
      COUNT(ai_grant.id) FILTER (
        WHERE ai_grant.status = 'EXHAUSTED' OR ai_grant.remaining_points = 0
      )::bigint AS exhausted_recipients,
      COALESCE(SUM(ai_grant.original_points), 0)::bigint AS issued_points,
      COALESCE(SUM(ai_grant.remaining_points), 0)::bigint AS remaining_points
    FROM worklog_commercial_config AS config
    LEFT JOIN worklog_ai_grants AS ai_grant
      ON ai_grant.type = 'FREE_INITIAL'
    GROUP BY config.id
  `;
}

function mapConfig(row: ConfigRow): FreeAiTrialConfigSnapshot {
  const issuedPoints = integer(row.issued_points);
  const remainingPoints = integer(row.remaining_points);
  return {
    freeInitialAiTrialPoints: integer(row.free_initial_ai_trial_points),
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
    recipients: integer(row.recipients),
    exhaustedRecipients: integer(row.exhausted_recipients),
    issuedPoints,
    remainingPoints,
    consumedPoints: Math.max(0, issuedPoints - remainingPoints),
  };
}

function integer(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('INVALID_COMMERCIAL_CONFIG_VALUE');
  return parsed;
}
