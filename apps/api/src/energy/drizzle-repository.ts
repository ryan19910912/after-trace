import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { EnergyBucket, EnergyLot } from './model';
import type { EnergyGrantRequest } from './products';

export type EnergyGrantResult = {
  status: 'GRANTED' | 'ALREADY_GRANTED' | 'REFERENCE_CONFLICT' | 'USER_NOT_FOUND';
  lotId: number | null;
  operationId: number | null;
};

type GrantRow = {
  status: EnergyGrantResult['status'];
  lot_id: string | null;
  operation_id: string | null;
};

type LotRow = {
  id: string;
  bucket: EnergyBucket;
  available_units: string;
  reserved_units: string;
  expires_at: string | Date | null;
};

function dateValue(value: string | Date | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

export class DrizzleUserEnergyRepository {
  constructor(private readonly db: Database) {}

  async listUsableLots(userId: number, at: Date): Promise<EnergyLot[]> {
    const result = await this.db.execute(sql`
      SELECT id::text, bucket, available_units::text, reserved_units::text, expires_at
      FROM user_energy_lots
      WHERE user_id = ${userId}
        AND available_units > 0
        AND (expires_at IS NULL OR expires_at > ${at})
      ORDER BY
        CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
        expires_at ASC NULLS LAST,
        CASE bucket WHEN 'FREE' THEN 0 WHEN 'PAID' THEN 1 ELSE 0 END,
        id ASC
    `);
    return result.rows.map((raw) => {
      const row = raw as LotRow;
      return {
        id: Number(row.id),
        bucket: row.bucket,
        availableUnits: BigInt(row.available_units),
        reservedUnits: BigInt(row.reserved_units),
        expiresAt: dateValue(row.expires_at),
      };
    });
  }

  async usableBalance(userId: number, at: Date): Promise<bigint> {
    const result = await this.db.execute(sql`
      SELECT COALESCE(SUM(available_units), 0)::text AS total
      FROM user_energy_lots
      WHERE user_id = ${userId}
        AND available_units > 0
        AND (expires_at IS NULL OR expires_at > ${at})
    `);
    return BigInt(String((result.rows[0] as { total?: string } | undefined)?.total ?? '0'));
  }

  async grant(request: EnergyGrantRequest): Promise<EnergyGrantResult> {
    const metadata = request.metadata ? JSON.stringify(request.metadata) : null;
    const result = await this.db.execute(sql`
      WITH existing AS (
        SELECT
          o.id AS operation_id,
          l.id AS lot_id,
          o.requested_units,
          l.bucket,
          l.expires_at
        FROM user_energy_operations o
        LEFT JOIN user_energy_lots l
          ON l.user_id = o.user_id
         AND l.source_type = o.reference_type
         AND l.source_id = o.reference_id
        WHERE o.user_id = ${request.userId}
          AND o.type = 'GRANT'
          AND o.reference_type = ${request.sourceType}
          AND o.reference_id = ${request.sourceId}
        LIMIT 1
      ), user_exists AS (
        SELECT id FROM line_users WHERE id = ${request.userId}
      ), inserted_operation AS (
        INSERT INTO user_energy_operations (
          user_id, type, requested_units, reference_type, reference_id, metadata
        )
        SELECT
          ${request.userId}, 'GRANT', ${request.units.toString()}::bigint,
          ${request.sourceType}, ${request.sourceId}, ${metadata}::jsonb
        WHERE EXISTS (SELECT 1 FROM user_exists)
          AND NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING id
      ), inserted_lot AS (
        INSERT INTO user_energy_lots (
          user_id, bucket, original_units, available_units, reserved_units,
          source_type, source_id, expires_at
        )
        SELECT
          ${request.userId}, ${request.bucket}, ${request.units.toString()}::bigint,
          ${request.units.toString()}::bigint, 0,
          ${request.sourceType}, ${request.sourceId}, ${request.expiresAt}
        FROM inserted_operation
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM user_exists) THEN 'USER_NOT_FOUND'
          WHEN EXISTS (SELECT 1 FROM existing WHERE requested_units <> ${request.units.toString()}::bigint OR bucket <> ${request.bucket} OR expires_at IS DISTINCT FROM ${request.expiresAt}) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing) THEN 'ALREADY_GRANTED'
          WHEN EXISTS (SELECT 1 FROM inserted_operation) AND EXISTS (SELECT 1 FROM inserted_lot) THEN 'GRANTED'
          ELSE 'ALREADY_GRANTED'
        END AS status,
        COALESCE((SELECT lot_id::text FROM existing), (SELECT id::text FROM inserted_lot)) AS lot_id,
        COALESCE((SELECT operation_id::text FROM existing), (SELECT id::text FROM inserted_operation)) AS operation_id
    `);
    const row = result.rows[0] as GrantRow | undefined;
    if (!row) throw new Error('user Energy grant returned no result');
    return {
      status: row.status,
      lotId: row.lot_id === null ? null : Number(row.lot_id),
      operationId: row.operation_id === null ? null : Number(row.operation_id),
    };
  }
}
