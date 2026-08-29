import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { EnergyBucket } from './model';

export type PrivateEnergyLot = {
  id: number;
  bucket: EnergyBucket;
  availableUnits: bigint;
  reservedUnits: bigint;
  expiresAt: Date | null;
  sourceType: string;
};

export type PrivateEnergyOverview = {
  userId: number;
  usableUnits: bigint;
  reservedUnits: bigint;
  buckets: Record<EnergyBucket, { usableUnits: bigint; reservedUnits: bigint }>;
  lots: PrivateEnergyLot[];
  proactive: {
    subscriptionUsable: boolean;
    paidUsable: boolean;
    enabled: boolean;
  };
};

function emptyBuckets(): PrivateEnergyOverview['buckets'] {
  return {
    FREE: { usableUnits: 0n, reservedUnits: 0n },
    SUBSCRIPTION: { usableUnits: 0n, reservedUnits: 0n },
    AD: { usableUnits: 0n, reservedUnits: 0n },
    PAID: { usableUnits: 0n, reservedUnits: 0n },
  };
}

export class DrizzlePrivateEnergyOverviewRepository {
  constructor(private readonly db: Database) {}

  async load(lineUserId: string, at: Date): Promise<PrivateEnergyOverview | null> {
    const userResult = await this.db.execute(sql`
      SELECT id::text AS id FROM line_users WHERE line_user_id = ${lineUserId} LIMIT 1
    `);
    const userIdValue = (userResult.rows[0] as { id?: string } | undefined)?.id;
    if (!userIdValue) return null;
    const userId = Number(userIdValue);

    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        bucket,
        available_units::text AS available_units,
        reserved_units::text AS reserved_units,
        expires_at,
        source_type
      FROM user_energy_lots
      WHERE user_id = ${userId}
        AND (available_units > 0 OR reserved_units > 0)
        AND (expires_at IS NULL OR expires_at > ${at} OR reserved_units > 0)
      ORDER BY
        CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
        expires_at ASC NULLS LAST,
        CASE bucket WHEN 'FREE' THEN 0 WHEN 'PAID' THEN 1 ELSE 0 END,
        id ASC
    `);

    const buckets = emptyBuckets();
    const lots: PrivateEnergyLot[] = [];
    for (const raw of result.rows) {
      const row = raw as {
        id: string;
        bucket: EnergyBucket;
        available_units: string;
        reserved_units: string;
        expires_at: Date | string | null;
        source_type: string;
      };
      const expiresAt = row.expires_at === null
        ? null
        : row.expires_at instanceof Date
          ? row.expires_at
          : new Date(row.expires_at);
      const isUsable = expiresAt === null || expiresAt.getTime() > at.getTime();
      const availableUnits = isUsable ? BigInt(row.available_units) : 0n;
      const reservedUnits = BigInt(row.reserved_units);
      buckets[row.bucket].usableUnits += availableUnits;
      buckets[row.bucket].reservedUnits += reservedUnits;
      lots.push({
        id: Number(row.id),
        bucket: row.bucket,
        availableUnits,
        reservedUnits,
        expiresAt,
        sourceType: row.source_type,
      });
    }

    const usableUnits = Object.values(buckets).reduce((sum, item) => sum + item.usableUnits, 0n);
    const reservedUnits = Object.values(buckets).reduce((sum, item) => sum + item.reservedUnits, 0n);
    const subscriptionUsable = buckets.SUBSCRIPTION.usableUnits > 0n;
    const paidUsable = buckets.PAID.usableUnits > 0n;
    return {
      userId,
      usableUnits,
      reservedUnits,
      buckets,
      lots,
      proactive: {
        subscriptionUsable,
        paidUsable,
        enabled: subscriptionUsable || paidUsable,
      },
    };
  }
}

export function serializePrivateEnergyOverview(overview: PrivateEnergyOverview) {
  return {
    ...overview,
    usableUnits: overview.usableUnits.toString(),
    reservedUnits: overview.reservedUnits.toString(),
    buckets: Object.fromEntries(
      Object.entries(overview.buckets).map(([bucket, value]) => [bucket, {
        usableUnits: value.usableUnits.toString(),
        reservedUnits: value.reservedUnits.toString(),
      }]),
    ),
    lots: overview.lots.map((lot) => ({
      ...lot,
      availableUnits: lot.availableUnits.toString(),
      reservedUnits: lot.reservedUnits.toString(),
      expiresAt: lot.expiresAt?.toISOString() ?? null,
    })),
  };
}
