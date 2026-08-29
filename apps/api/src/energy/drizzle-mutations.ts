import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  EnergyConsumeRequest,
  EnergyMutationResult,
  EnergyReservationMutationRequest,
  EnergyReserveRequest,
  UserEnergyMutationRepository,
} from './ledger';

function metadataJson(value?: Record<string, unknown>): string | null {
  return value ? JSON.stringify(value) : null;
}

function mutation(row: Record<string, unknown> | undefined): EnergyMutationResult {
  if (!row) throw new Error('User Energy mutation returned no result');
  return {
    status: String(row.status) as EnergyMutationResult['status'],
    operationId: row.operation_id == null ? null : Number(row.operation_id),
    reservationId: row.reservation_id == null ? undefined : Number(row.reservation_id),
  };
}

export class DrizzleUserEnergyMutationRepository implements UserEnergyMutationRepository {
  constructor(private readonly db: Database) {}

  async consume(request: EnergyConsumeRequest): Promise<EnergyMutationResult> {
    const metadata = metadataJson(request.metadata);
    const result = await this.db.execute(sql`
      WITH existing AS (
        SELECT id, requested_units
        FROM user_energy_operations
        WHERE user_id = ${request.userId}
          AND type = 'CONSUME'
          AND reference_type = ${request.reference.type}
          AND reference_id = ${request.reference.id}
        LIMIT 1
      ), user_exists AS (
        SELECT id FROM line_users WHERE id = ${request.userId}
      ), locked AS MATERIALIZED (
        SELECT id, bucket, available_units, expires_at
        FROM user_energy_lots
        WHERE user_id = ${request.userId}
          AND available_units > 0
          AND (expires_at IS NULL OR expires_at > ${request.at})
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
          ), 0) AS before_units
        FROM locked
      ), allocation AS (
        SELECT id, bucket,
          LEAST(available_units, GREATEST(${request.units.toString()}::bigint - before_units, 0)) AS units
        FROM ordered
      ), sufficient AS (
        SELECT COALESCE(SUM(units), 0) >= ${request.units.toString()}::bigint AS ok
        FROM allocation
      ), inserted_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata
        )
        SELECT ${request.userId}, 'CONSUME', ${request.units.toString()}::bigint,
          ${request.reference.type}, ${request.reference.id}, ${metadata}::jsonb
        WHERE EXISTS (SELECT 1 FROM user_exists)
          AND NOT EXISTS (SELECT 1 FROM existing)
          AND (SELECT ok FROM sufficient)
        ON CONFLICT DO NOTHING
        RETURNING id
      ), updated AS (
        UPDATE user_energy_lots l
        SET available_units = l.available_units - a.units,
            updated_at = NOW()
        FROM allocation a, inserted_operation o
        WHERE l.id = a.id AND a.units > 0
        RETURNING l.id, l.bucket, a.units, o.id AS operation_id
      ), transactions AS (
        INSERT INTO user_energy_transactions (operation_id, user_id, lot_id, bucket, type, units)
        SELECT operation_id, ${request.userId}, id, bucket, 'CONSUME', units
        FROM updated
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM user_exists) THEN 'USER_NOT_FOUND'
          WHEN EXISTS (SELECT 1 FROM existing WHERE requested_units <> ${request.units.toString()}::bigint) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_APPLIED'
          WHEN NOT (SELECT ok FROM sufficient) THEN 'INSUFFICIENT_ENERGY'
          WHEN EXISTS (SELECT 1 FROM inserted_operation) THEN 'APPLIED'
          ELSE 'ALREADY_APPLIED'
        END AS status,
        COALESCE((SELECT id::text FROM existing), (SELECT id::text FROM inserted_operation)) AS operation_id
    `);
    return mutation(result.rows[0] as Record<string, unknown> | undefined);
  }

  async reserve(request: EnergyReserveRequest): Promise<EnergyMutationResult> {
    const metadata = metadataJson(request.metadata);
    const allowSubscription = request.allowedBuckets?.includes('SUBSCRIPTION') ?? true;
    const allowPaid = request.allowedBuckets?.includes('PAID') ?? true;
    const result = await this.db.execute(sql`
      WITH existing_operation AS (
        SELECT id, requested_units
        FROM user_energy_operations
        WHERE user_id = ${request.userId}
          AND type = 'RESERVE'
          AND reference_type = ${request.reference.type}
          AND reference_id = ${request.reference.id}
        LIMIT 1
      ), existing_reservation AS (
        SELECT id, requested_units, valid_through, reserve_operation_id
        FROM user_energy_reservations
        WHERE user_id = ${request.userId}
          AND reference_type = ${request.reference.type}
          AND reference_id = ${request.reference.id}
        LIMIT 1
      ), user_exists AS (
        SELECT id FROM line_users WHERE id = ${request.userId}
      ), locked AS MATERIALIZED (
        SELECT id, bucket, available_units, expires_at
        FROM user_energy_lots
        WHERE user_id = ${request.userId}
          AND available_units > 0
          AND (expires_at IS NULL OR expires_at > ${request.at})
          AND (
            (${allowSubscription} AND bucket = 'SUBSCRIPTION' AND expires_at > ${request.validThrough})
            OR (${allowPaid} AND bucket = 'PAID' AND expires_at IS NULL)
          )
        ORDER BY
          CASE WHEN bucket = 'SUBSCRIPTION' THEN 0 ELSE 1 END,
          expires_at ASC NULLS LAST,
          id ASC
        FOR UPDATE
      ), ordered AS (
        SELECT *,
          COALESCE(SUM(available_units) OVER (
            ORDER BY CASE WHEN bucket = 'SUBSCRIPTION' THEN 0 ELSE 1 END,
                     expires_at ASC NULLS LAST, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS before_units
        FROM locked
      ), allocation AS (
        SELECT id, bucket,
          LEAST(available_units, GREATEST(${request.units.toString()}::bigint - before_units, 0)) AS units
        FROM ordered
      ), sufficient AS (
        SELECT COALESCE(SUM(units), 0) >= ${request.units.toString()}::bigint AS ok FROM allocation
      ), inserted_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata
        )
        SELECT ${request.userId}, 'RESERVE', ${request.units.toString()}::bigint,
          ${request.reference.type}, ${request.reference.id}, ${metadata}::jsonb
        WHERE EXISTS (SELECT 1 FROM user_exists)
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
          AND NOT EXISTS (SELECT 1 FROM existing_reservation)
          AND (SELECT ok FROM sufficient)
        ON CONFLICT DO NOTHING
        RETURNING id
      ), inserted_reservation AS (
        INSERT INTO user_energy_reservations (
          user_id, reserve_operation_id, reference_type, reference_id,
          requested_units, status, valid_through
        )
        SELECT ${request.userId}, id, ${request.reference.type}, ${request.reference.id},
          ${request.units.toString()}::bigint, 'RESERVED', ${request.validThrough}
        FROM inserted_operation
        RETURNING id, reserve_operation_id
      ), updated AS (
        UPDATE user_energy_lots l
        SET available_units = l.available_units - a.units,
            reserved_units = l.reserved_units + a.units,
            updated_at = NOW()
        FROM allocation a, inserted_operation o
        WHERE l.id = a.id AND a.units > 0
        RETURNING l.id, l.bucket, a.units, o.id AS operation_id
      ), tx AS (
        INSERT INTO user_energy_transactions (operation_id, user_id, lot_id, bucket, type, units)
        SELECT operation_id, ${request.userId}, id, bucket, 'RESERVE', units FROM updated
        ON CONFLICT DO NOTHING RETURNING id
      ), reservation_allocations AS (
        INSERT INTO user_energy_reservation_allocations (reservation_id, lot_id, units)
        SELECT r.id, u.id, u.units
        FROM inserted_reservation r CROSS JOIN updated u
        ON CONFLICT DO NOTHING RETURNING id
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM user_exists) THEN 'USER_NOT_FOUND'
          WHEN EXISTS (
            SELECT 1 FROM existing_operation
            WHERE requested_units <> ${request.units.toString()}::bigint
          ) OR EXISTS (
            SELECT 1 FROM existing_reservation
            WHERE requested_units <> ${request.units.toString()}::bigint
               OR valid_through IS DISTINCT FROM ${request.validThrough}
          ) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing_reservation) THEN 'ALREADY_APPLIED'
          WHEN NOT (SELECT ok FROM sufficient) THEN 'INSUFFICIENT_ENERGY'
          WHEN EXISTS (SELECT 1 FROM inserted_reservation) THEN 'APPLIED'
          ELSE 'ALREADY_APPLIED'
        END AS status,
        COALESCE(
          (SELECT reserve_operation_id::text FROM existing_reservation),
          (SELECT id::text FROM inserted_operation)
        ) AS operation_id,
        COALESCE(
          (SELECT id::text FROM existing_reservation),
          (SELECT id::text FROM inserted_reservation)
        ) AS reservation_id
    `);
    return mutation(result.rows[0] as Record<string, unknown> | undefined);
  }

  async releaseReservation(request: EnergyReservationMutationRequest): Promise<EnergyMutationResult> {
    return this.settleReservation(request, 'RELEASE');
  }

  async consumeReservation(request: EnergyReservationMutationRequest): Promise<EnergyMutationResult> {
    return this.settleReservation(request, 'RESERVED_CONSUME');
  }

  private async settleReservation(
    request: EnergyReservationMutationRequest,
    type: 'RELEASE' | 'RESERVED_CONSUME',
  ): Promise<EnergyMutationResult> {
    const metadata = metadataJson(request.metadata);
    const targetStatus = type === 'RELEASE' ? 'RELEASED' : 'CONSUMED';
    const result = await this.db.execute(sql`
      WITH reservation AS MATERIALIZED (
        SELECT id, reserve_operation_id, requested_units, status
        FROM user_energy_reservations
        WHERE user_id = ${request.userId}
          AND reference_type = ${request.reference.type}
          AND reference_id = ${request.reference.id}
        FOR UPDATE
      ), existing AS (
        SELECT id, requested_units
        FROM user_energy_operations
        WHERE user_id = ${request.userId}
          AND type = ${type}
          AND reference_type = ${request.mutationReference.type}
          AND reference_id = ${request.mutationReference.id}
        LIMIT 1
      ), inserted_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata
        )
        SELECT ${request.userId}, ${type}, r.requested_units,
          ${request.mutationReference.type}, ${request.mutationReference.id}, ${metadata}::jsonb
        FROM reservation r
        WHERE r.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING id, requested_units
      ), allocations AS MATERIALIZED (
        SELECT a.lot_id, a.units, l.bucket
        FROM user_energy_reservation_allocations a
        JOIN user_energy_lots l ON l.id = a.lot_id
        JOIN reservation r ON r.id = a.reservation_id
        FOR UPDATE OF l
      ), updated_lots AS (
        UPDATE user_energy_lots l
        SET reserved_units = l.reserved_units - a.units,
            available_units = CASE WHEN ${type} = 'RELEASE' THEN l.available_units + a.units ELSE l.available_units END,
            updated_at = NOW()
        FROM allocations a, inserted_operation o
        WHERE l.id = a.lot_id
          AND l.reserved_units >= a.units
        RETURNING l.id, a.bucket, a.units, o.id AS operation_id
      ), tx AS (
        INSERT INTO user_energy_transactions (operation_id, user_id, lot_id, bucket, type, units)
        SELECT operation_id, ${request.userId}, id, bucket, ${type}, units FROM updated_lots
        ON CONFLICT DO NOTHING RETURNING id
      ), updated_reservation AS (
        UPDATE user_energy_reservations r
        SET status = ${targetStatus}, updated_at = NOW()
        FROM inserted_operation o
        WHERE r.id = (SELECT id FROM reservation)
          AND r.status = 'RESERVED'
          AND (SELECT COUNT(*) FROM updated_lots) = (SELECT COUNT(*) FROM allocations)
        RETURNING r.id
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM reservation) THEN 'RESERVATION_NOT_FOUND'
          WHEN EXISTS (SELECT 1 FROM existing WHERE requested_units <> (SELECT requested_units FROM reservation)) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_APPLIED'
          WHEN (SELECT status FROM reservation) <> 'RESERVED' THEN 'RESERVATION_STATE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM updated_reservation) THEN 'APPLIED'
          ELSE 'RESERVATION_STATE_CONFLICT'
        END AS status,
        COALESCE((SELECT id::text FROM existing), (SELECT id::text FROM inserted_operation)) AS operation_id,
        (SELECT id::text FROM reservation) AS reservation_id
    `);
    return mutation(result.rows[0] as Record<string, unknown> | undefined);
  }
}
