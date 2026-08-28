import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { formatTwdCostUnits, parseTwdCostUnits } from './allocation';
import type { WelcomeAttribution, WelcomeCreditRepository } from './welcome';

type AttributionRow = {
  attribution_state: 'CREATED' | 'EXISTING';
  id: string;
  group_id: string;
  line_user_id: string;
  is_first_group: boolean;
  amount_cost_twd: string;
  grant_operation_id: string | null;
};

function mapAttribution(row: AttributionRow): WelcomeAttribution {
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    lineUserId: row.line_user_id,
    isFirstGroup: row.is_first_group,
    amountUnits: parseTwdCostUnits(row.amount_cost_twd),
    grantOperationId: row.grant_operation_id === null ? null : Number(row.grant_operation_id),
    state: row.attribution_state,
  };
}

export class DrizzleWelcomeCreditRepository implements WelcomeCreditRepository {
  constructor(private readonly db: Database) {}

  async claimAttribution(
    groupId: number,
    lineUserId: string,
    firstAmountUnits: bigint,
    laterAmountUnits: bigint,
    at: Date,
  ): Promise<WelcomeAttribution> {
    const firstAmount = formatTwdCostUnits(firstAmountUnits);
    const laterAmount = formatTwdCostUnits(laterAmountUnits);

    const run = async () => {
      const result = await this.db.execute(sql`
        WITH inserted AS (
          INSERT INTO welcome_credit_attributions (
            group_id,
            line_user_id,
            is_first_group,
            amount_cost_twd,
            created_at,
            updated_at
          )
          VALUES (${groupId}, ${lineUserId}, FALSE, 0, ${at}, ${at})
          ON CONFLICT (group_id) DO NOTHING
          RETURNING id
        ),
        counter AS (
          INSERT INTO welcome_credit_user_state (line_user_id, group_count, updated_at)
          SELECT ${lineUserId}, 1, ${at}
          FROM inserted
          ON CONFLICT (line_user_id) DO UPDATE
          SET group_count = welcome_credit_user_state.group_count + 1,
              updated_at = GREATEST(welcome_credit_user_state.updated_at, EXCLUDED.updated_at)
          RETURNING group_count
        ),
        finalized AS (
          UPDATE welcome_credit_attributions AS attribution
          SET is_first_group = (counter.group_count = 1),
              amount_cost_twd = CASE
                WHEN counter.group_count = 1 THEN CAST(${firstAmount} AS numeric)
                ELSE CAST(${laterAmount} AS numeric)
              END,
              updated_at = ${at}
          FROM inserted, counter
          WHERE attribution.id = inserted.id
          RETURNING attribution.*
        )
        SELECT
          'CREATED'::text AS attribution_state,
          id::text AS id,
          group_id::text AS group_id,
          line_user_id,
          is_first_group,
          amount_cost_twd::text AS amount_cost_twd,
          grant_operation_id::text AS grant_operation_id
        FROM finalized
        UNION ALL
        SELECT
          'EXISTING'::text AS attribution_state,
          attribution.id::text AS id,
          attribution.group_id::text AS group_id,
          attribution.line_user_id,
          attribution.is_first_group,
          attribution.amount_cost_twd::text AS amount_cost_twd,
          attribution.grant_operation_id::text AS grant_operation_id
        FROM welcome_credit_attributions AS attribution
        WHERE attribution.group_id = ${groupId}
          AND NOT EXISTS (SELECT 1 FROM finalized)
        LIMIT 1
      `);
      return result.rows[0] as AttributionRow | undefined;
    };

    const row = (await run()) ?? (await run());
    if (!row) throw new Error('failed to claim welcome credit attribution');
    return mapAttribution(row);
  }

  async completeAttribution(
    attributionId: number,
    operationId: number,
    at: Date,
  ): Promise<'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT'> {
    const result = await this.db.execute(sql`
      WITH updated AS (
        UPDATE welcome_credit_attributions
        SET grant_operation_id = ${operationId},
            granted_at = ${at},
            updated_at = ${at}
        WHERE id = ${attributionId}
          AND grant_operation_id IS NULL
        RETURNING id, group_id, line_user_id, amount_cost_twd
      ),
      audit AS (
        INSERT INTO audit_logs (
          group_id,
          actor_line_user_id,
          action,
          target_type,
          target_id,
          after_value,
          created_at
        )
        SELECT
          group_id,
          line_user_id,
          'WELCOME_CREDIT_GRANTED',
          'WELCOME_CREDIT_ATTRIBUTION',
          id::text,
          jsonb_build_object(
            'amountCostTwd', amount_cost_twd::text,
            'operationId', ${operationId}
          ),
          ${at}
        FROM updated
        RETURNING id
      )
      SELECT 'COMPLETED'::text AS status
      FROM updated
      UNION ALL
      SELECT CASE
        WHEN grant_operation_id = ${operationId} THEN 'ALREADY_COMPLETED'
        ELSE 'CONFLICT'
      END AS status
      FROM welcome_credit_attributions
      WHERE id = ${attributionId}
        AND NOT EXISTS (SELECT 1 FROM updated)
      LIMIT 1
    `);

    const row = result.rows[0] as
      | { status: 'COMPLETED' | 'ALREADY_COMPLETED' | 'CONFLICT' }
      | undefined;
    if (!row) throw new Error('welcome credit attribution not found during completion');
    return row.status;
  }
}
