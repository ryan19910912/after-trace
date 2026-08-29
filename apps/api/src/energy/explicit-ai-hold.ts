import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';

export type ExplicitAiHoldResult =
  | { status: 'RESERVED' | 'ALREADY_RESERVED'; requestId: number }
  | { status: 'INSUFFICIENT_ENERGY' | 'REFERENCE_CONFLICT'; requestId: number };

export type ExplicitAiHoldSettlementResult =
  | { status: 'SETTLED' | 'ALREADY_SETTLED' }
  | { status: 'HOLD_NOT_FOUND' | 'REFERENCE_CONFLICT' };

export class DrizzleExplicitAiEnergyHoldRepository {
  constructor(private readonly db: Database) {}

  async reserve(input: {
    requestId: number;
    userId: number;
    maxUnits: bigint;
    at: Date;
  }): Promise<ExplicitAiHoldResult> {
    const result = await this.db.execute(sql`
      WITH existing AS MATERIALIZED (
        SELECT request_id, user_id, reserved_units, status
        FROM explicit_ai_energy_holds
        WHERE request_id = ${input.requestId}
      ), locked AS MATERIALIZED (
        SELECT id, bucket, available_units, expires_at
        FROM user_energy_lots
        WHERE user_id = ${input.userId}
          AND available_units > 0
          AND (expires_at IS NULL OR expires_at > ${input.at})
        ORDER BY
          CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
          expires_at ASC NULLS LAST,
          CASE bucket WHEN 'FREE' THEN 0 WHEN 'PAID' THEN 1 ELSE 0 END,
          id ASC
        FOR UPDATE
      ), ordered AS (
        SELECT *,
          COALESCE(SUM(available_units) OVER (
            ORDER BY
              CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
              expires_at ASC NULLS LAST,
              CASE bucket WHEN 'FREE' THEN 0 WHEN 'PAID' THEN 1 ELSE 0 END,
              id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0)::bigint AS before_units
        FROM locked
      ), allocation AS (
        SELECT id,
          LEAST(available_units, GREATEST(${input.maxUnits.toString()}::bigint - before_units, 0))::bigint AS units
        FROM ordered
      ), sufficient AS (
        SELECT COALESCE(SUM(units), 0)::bigint >= ${input.maxUnits.toString()}::bigint AS ok
        FROM allocation
      ), inserted_hold AS (
        INSERT INTO explicit_ai_energy_holds (
          request_id, user_id, reserved_units, status, created_at, updated_at
        )
        SELECT ${input.requestId}, ${input.userId}, ${input.maxUnits.toString()}::bigint, 'RESERVED', ${input.at}, ${input.at}
        WHERE NOT EXISTS (SELECT 1 FROM existing)
          AND (SELECT ok FROM sufficient)
        ON CONFLICT DO NOTHING
        RETURNING request_id
      ), updated_lots AS (
        UPDATE user_energy_lots lot
        SET available_units = lot.available_units - allocation.units,
            reserved_units = lot.reserved_units + allocation.units,
            updated_at = ${input.at}
        FROM allocation, inserted_hold
        WHERE lot.id = allocation.id
          AND allocation.units > 0
        RETURNING lot.id, allocation.units
      ), saved_allocations AS (
        INSERT INTO explicit_ai_energy_hold_allocations (request_id, lot_id, units, created_at)
        SELECT ${input.requestId}, id, units, ${input.at}
        FROM updated_lots
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM existing
          WHERE user_id <> ${input.userId}
             OR reserved_units <> ${input.maxUnits.toString()}::bigint
        ) THEN 'REFERENCE_CONFLICT'
        WHEN EXISTS (SELECT 1 FROM existing WHERE status = 'RESERVED') THEN 'ALREADY_RESERVED'
        WHEN EXISTS (SELECT 1 FROM existing) THEN 'REFERENCE_CONFLICT'
        WHEN NOT (SELECT ok FROM sufficient) THEN 'INSUFFICIENT_ENERGY'
        WHEN EXISTS (SELECT 1 FROM inserted_hold)
          AND (SELECT COALESCE(SUM(units), 0) FROM updated_lots) = ${input.maxUnits.toString()}::bigint
          THEN 'RESERVED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status
    `);
    return {
      status: String((result.rows[0] as { status?: string } | undefined)?.status ?? 'REFERENCE_CONFLICT') as ExplicitAiHoldResult['status'],
      requestId: input.requestId,
    } as ExplicitAiHoldResult;
  }

  async settle(input: {
    requestId: number;
    userId: number;
    actualUnits: bigint;
    at: Date;
  }): Promise<ExplicitAiHoldSettlementResult> {
    const result = await this.db.execute(sql`
      WITH hold AS MATERIALIZED (
        SELECT request_id, user_id, reserved_units, actual_units, status
        FROM explicit_ai_energy_holds
        WHERE request_id = ${input.requestId}
          AND user_id = ${input.userId}
        FOR UPDATE
      ), allocations AS MATERIALIZED (
        SELECT allocation.lot_id, allocation.units, lot.bucket
        FROM explicit_ai_energy_hold_allocations allocation
        JOIN user_energy_lots lot ON lot.id = allocation.lot_id
        WHERE allocation.request_id = ${input.requestId}
        ORDER BY allocation.id
        FOR UPDATE OF lot
      ), ordered AS (
        SELECT *,
          COALESCE(SUM(units) OVER (
            ORDER BY lot_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0)::bigint AS before_units
        FROM allocations
      ), split AS (
        SELECT
          lot_id,
          bucket,
          units,
          LEAST(units, GREATEST(${input.actualUnits.toString()}::bigint - before_units, 0))::bigint AS consume_units
        FROM ordered
      ), valid AS (
        SELECT EXISTS (
          SELECT 1 FROM hold
          WHERE status = 'RESERVED'
            AND ${input.actualUnits.toString()}::bigint >= 0
            AND ${input.actualUnits.toString()}::bigint <= reserved_units
        ) AS ok
      ), consume_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT ${input.userId}, 'RESERVED_CONSUME', ${input.actualUnits.toString()}::bigint,
          'AI_CHAT_SETTLE', ${String(input.requestId)},
          jsonb_build_object('requestId', ${input.requestId}), ${input.at}
        WHERE (SELECT ok FROM valid)
          AND ${input.actualUnits.toString()}::bigint > 0
        ON CONFLICT DO NOTHING
        RETURNING id
      ), release_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT ${input.userId}, 'RELEASE', reserved_units - ${input.actualUnits.toString()}::bigint,
          'AI_CHAT_RELEASE', ${String(input.requestId)},
          jsonb_build_object('requestId', ${input.requestId}), ${input.at}
        FROM hold
        WHERE (SELECT ok FROM valid)
          AND reserved_units > ${input.actualUnits.toString()}::bigint
        ON CONFLICT DO NOTHING
        RETURNING id
      ), updated AS (
        UPDATE user_energy_lots lot
        SET reserved_units = lot.reserved_units - split.units,
            available_units = lot.available_units + (split.units - split.consume_units),
            updated_at = ${input.at}
        FROM split
        WHERE lot.id = split.lot_id
          AND (SELECT ok FROM valid)
          AND lot.reserved_units >= split.units
        RETURNING lot.id, split.bucket, split.units, split.consume_units
      ), consume_tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT operation.id, ${input.userId}, updated.id, updated.bucket,
          'RESERVED_CONSUME', updated.consume_units, ${input.at}
        FROM updated CROSS JOIN consume_operation operation
        WHERE updated.consume_units > 0
        ON CONFLICT DO NOTHING
        RETURNING id
      ), release_tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT operation.id, ${input.userId}, updated.id, updated.bucket,
          'RELEASE', updated.units - updated.consume_units, ${input.at}
        FROM updated CROSS JOIN release_operation operation
        WHERE updated.units > updated.consume_units
        ON CONFLICT DO NOTHING
        RETURNING id
      ), settled AS (
        UPDATE explicit_ai_energy_holds
        SET actual_units = ${input.actualUnits.toString()}::bigint,
            status = 'SETTLED',
            updated_at = ${input.at}
        WHERE request_id = ${input.requestId}
          AND user_id = ${input.userId}
          AND status = 'RESERVED'
          AND (SELECT ok FROM valid)
          AND (SELECT COUNT(*) FROM updated) = (SELECT COUNT(*) FROM allocations)
        RETURNING request_id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM hold) THEN 'HOLD_NOT_FOUND'
        WHEN EXISTS (
          SELECT 1 FROM hold
          WHERE status = 'SETTLED' AND actual_units = ${input.actualUnits.toString()}::bigint
        ) THEN 'ALREADY_SETTLED'
        WHEN EXISTS (SELECT 1 FROM settled) THEN 'SETTLED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status
    `);
    return {
      status: String((result.rows[0] as { status?: string } | undefined)?.status ?? 'REFERENCE_CONFLICT') as ExplicitAiHoldSettlementResult['status'],
    };
  }

  async release(input: { requestId: number; userId: number; at: Date }): Promise<void> {
    const result = await this.db.execute(sql`
      WITH hold AS MATERIALIZED (
        SELECT request_id, reserved_units, status
        FROM explicit_ai_energy_holds
        WHERE request_id = ${input.requestId}
          AND user_id = ${input.userId}
        FOR UPDATE
      ), allocations AS MATERIALIZED (
        SELECT allocation.lot_id, allocation.units, lot.bucket
        FROM explicit_ai_energy_hold_allocations allocation
        JOIN user_energy_lots lot ON lot.id = allocation.lot_id
        WHERE allocation.request_id = ${input.requestId}
        FOR UPDATE OF lot
      ), operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata, created_at
        )
        SELECT ${input.userId}, 'RELEASE', reserved_units,
          'AI_CHAT_ABORT_RELEASE', ${String(input.requestId)},
          jsonb_build_object('requestId', ${input.requestId}), ${input.at}
        FROM hold
        WHERE status = 'RESERVED'
        ON CONFLICT DO NOTHING
        RETURNING id
      ), updated AS (
        UPDATE user_energy_lots lot
        SET reserved_units = lot.reserved_units - allocations.units,
            available_units = lot.available_units + allocations.units,
            updated_at = ${input.at}
        FROM allocations, operation
        WHERE lot.id = allocations.lot_id
          AND lot.reserved_units >= allocations.units
        RETURNING lot.id, allocations.bucket, allocations.units
      ), tx AS (
        INSERT INTO user_energy_transactions (
          operation_id, user_id, lot_id, bucket, type, units, created_at
        )
        SELECT operation.id, ${input.userId}, updated.id, updated.bucket, 'RELEASE', updated.units, ${input.at}
        FROM updated CROSS JOIN operation
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      UPDATE explicit_ai_energy_holds
      SET status = 'RELEASED', updated_at = ${input.at}
      WHERE request_id = ${input.requestId}
        AND user_id = ${input.userId}
        AND status = 'RESERVED'
        AND (SELECT COUNT(*) FROM updated) = (SELECT COUNT(*) FROM allocations)
    `);
    void result;
  }
}
